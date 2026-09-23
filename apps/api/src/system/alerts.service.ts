import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { dayOf, readEntries, writeLog, type LogEntry } from '../logging/file-log';
import { MailerService } from '../notifications/mailer.service';
import { SettingsService, type AlertSettings } from '../settings/settings.service';

const KEY = 'alerts';
const EVERY_MS = 60_000;
/** A burst of errors becomes one email, not fifty. */
const COOLDOWN_MS = 5 * 60_000;
/** Turning alerts on should not mail out the whole history. */
const FIRST_LOOKBACK_MS = 60 * 60_000;
const MAX_LINES = 30;

export const DEFAULT_ALERTS: AlertSettings = { enabled: false, recipients: [], cursor: null, lastSentAt: null };

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);

/**
 * Emails the admin when the server logs an error or a crash.
 *
 * Reads the same daily log files the Server logs page shows, so it also
 * catches a start-up failure: that process dies before it can send anything,
 * and the next one that starts reports it.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
    // Soon after start: this is when a crash of the previous process is reported.
    setTimeout(() => void this.run(), 20_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async read(): Promise<AlertSettings> {
    return { ...DEFAULT_ALERTS, ...((await this.settings.get<AlertSettings>(KEY)) ?? {}) };
  }

  async save(input: { enabled: boolean; recipients: string[] }, userId: string): Promise<AlertSettings> {
    const current = await this.read();
    const next: AlertSettings = {
      ...current,
      enabled: input.enabled,
      recipients: [...new Set(input.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))],
      // Switching on starts from now, not from whatever happened last week.
      cursor: input.enabled && !current.enabled ? new Date().toISOString() : current.cursor,
    };
    await this.settings.set(KEY, next, userId);
    return next;
  }

  async sendTest(recipients: string[]): Promise<void> {
    const to = recipients.length ? recipients : (await this.read()).recipients;
    if (to.length === 0) throw new Error('Add at least one email address first.');
    await this.mailer.send({
      to,
      subject: '[Phone ERP] Test alert — error emails are working',
      html: this.render(
        [{ t: new Date().toISOString(), level: 'info', ctx: 'Alerts', msg: 'This is a test. Real alerts list the errors and crashes the server logged.', pid: process.pid }],
        0,
        false,
      ),
      text: 'Test alert from Phone ERP. Real alerts list the errors and crashes the server logged.',
    });
  }

  /** One pass: anything new and serious since the last email is sent in one message. */
  async run(): Promise<{ sent: number }> {
    if (this.running) return { sent: 0 };
    this.running = true;
    try {
      const alerts = await this.read();
      if (!alerts.enabled || alerts.recipients.length === 0) return { sent: 0 };
      if (!(await this.mailer.server()).host) return { sent: 0 };
      if (alerts.lastSentAt && Date.now() - Date.parse(alerts.lastSentAt) < COOLDOWN_MS) return { sent: 0 };

      const since = alerts.cursor ?? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString();
      const yesterday = dayOf(new Date(Date.now() - 86_400_000));
      const fresh = [...readEntries(yesterday), ...readEntries(dayOf())].filter(
        (e) => e.t > since && (e.level === 'error' || e.level === 'fatal') && e.ctx !== 'Alerts',
      );
      if (fresh.length === 0) return { sent: 0 };

      const fatal = fresh.some((e) => e.level === 'fatal');
      const shown = fresh.slice(-MAX_LINES);
      const subject = fatal
        ? `[Phone ERP] The server crashed or could not start (${fresh.length} problem${fresh.length === 1 ? '' : 's'})`
        : `[Phone ERP] ${fresh.length} error${fresh.length === 1 ? '' : 's'} on the server`;

      await this.mailer.send({
        to: alerts.recipients,
        subject,
        html: this.render(shown, fresh.length - shown.length, fatal),
        text: [
          subject,
          '',
          ...shown.map((e) => `${e.t}  ${e.level.toUpperCase()}  [${e.ctx}] ${e.msg}`),
          '',
          'Details: Settings → Server logs in the app.',
        ].join('\n'),
      });

      await this.settings.set(KEY, {
        ...alerts,
        cursor: fresh[fresh.length - 1]!.t,
        lastSentAt: new Date().toISOString(),
      });
      return { sent: fresh.length };
    } catch (error) {
      // Logged as a warning under "Alerts", which the scan skips — a broken
      // mail server must not turn into an endless loop of alert emails.
      writeLog('warn', 'Alerts', `Could not send the error alert: ${String(error)}`);
      return { sent: 0 };
    } finally {
      this.running = false;
    }
  }

  private render(entries: LogEntry[], hidden: number, fatal: boolean): string {
    const colour = fatal ? '#b91c1c' : '#c2410c';
    const rows = entries
      .map(
        (e) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font:12px monospace;color:#555;white-space:nowrap;vertical-align:top;">${escape(e.t.replace('T', ' ').slice(0, 19))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font:bold 11px sans-serif;color:${e.level === 'fatal' ? '#b91c1c' : e.level === 'error' ? '#c2410c' : '#2563eb'};text-transform:uppercase;vertical-align:top;">${escape(e.level)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font:13px sans-serif;color:#111;">
            <b>${escape(e.ctx)}</b> ${escape(e.msg)}
            ${typeof e.detail === 'string' && e.level === 'fatal' ? `<pre style="margin:6px 0 0;font:11px monospace;color:#555;white-space:pre-wrap;">${escape(e.detail.slice(0, 1500))}</pre>` : ''}
          </td>
        </tr>`,
      )
      .join('');
    return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#eef0f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;border:1px solid #dfe3ea;">
    <tr><td style="padding:20px 24px;background:${colour};border-radius:10px 10px 0 0;color:#fff;">
      <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;opacity:.85;">Phone ERP · Server alert</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">&#9888;&#65039; ${fatal ? 'The server crashed or could not start' : 'Errors on the server'}</div>
    </td></tr>
    <tr><td style="padding:16px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
      ${hidden > 0 ? `<p style="font-size:12px;color:#555;">…and ${hidden} earlier line${hidden === 1 ? '' : 's'}.</p>` : ''}
      <p style="font-size:13px;color:#333;margin-top:16px;">Open <b>Settings → Server logs</b> in the app for the full details.</p>
    </td></tr>
    <tr><td style="padding:12px 24px;border-top:1px solid #eee;font-size:11px;color:#777;">At most one alert every 5 minutes. Change the recipients on the Server logs page.</td></tr>
  </table></body></html>`;
  }
}
