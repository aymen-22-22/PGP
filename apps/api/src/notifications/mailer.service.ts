import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../common/tokens';
import type { AppConfig } from '../config/configuration';
import { SettingsService, type SmtpSettings } from '../settings/settings.service';

export interface MailServer {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  enabled: boolean;
  /** Where these settings came from — the app's Settings page or the server's environment. */
  source: 'app' | 'env';
}

/**
 * The SMTP connection, and nothing else.
 *
 * Kept apart from composing and queueing so the rest of the system can be
 * tested without a mail server: in tests the transport collects messages in
 * memory and `sent()` reads them back, which is how the templates are asserted
 * on without anything leaving the machine.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private transport: Transporter | null = null;
  private transportKey = '';
  /** Only populated by the in-memory transport used in tests. */
  private readonly outbox: { to: string[]; subject: string; html: string; text: string }[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The mail server in use: what an admin saved in Settings, or else the
   * environment. Saved settings win so the server can be changed without SSH.
   */
  async server(): Promise<MailServer> {
    const saved = await this.settings.get<SmtpSettings>('smtp');
    if (saved?.host) {
      let pass = '';
      try {
        pass = saved.passEnc ? this.settings.decrypt(saved.passEnc) : '';
      } catch {
        this.log.warn('The saved mail password could not be decrypted (JWT secret changed?) — enter it again');
      }
      return { host: saved.host, port: saved.port, secure: saved.secure, user: saved.user, pass, from: saved.from, enabled: saved.enabled, source: 'app' };
    }
    const { host, port, secure, user, pass, from, enabled } = this.config.mail;
    return { host, port, secure, user, pass, from, enabled, source: 'env' };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.server()).enabled;
  }

  /**
   * Hands the message to the mail server, or throws.
   *
   * Throwing is the point: the caller records the failure and tries again
   * later, so a server that is briefly down delays a message rather than
   * dropping it on the floor.
   */
  async send(message: { to: string[]; subject: string; html: string; text: string }): Promise<void> {
    if (message.to.length === 0) return;

    const server = await this.server();
    const transport = this.connect(server);
    await transport.sendMail({
      from: server.from,
      // Recipients go in bcc: an operational email should not hand every
      // warehouse a list of everyone else's address.
      bcc: message.to,
      to: server.from,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (!server.host) this.outbox.push(message);
  }

  /** Messages captured in memory. Empty unless the capturing transport is in use. */
  sent(): readonly { to: string[]; subject: string; html: string; text: string }[] {
    return this.outbox;
  }

  clearSent(): void {
    this.outbox.length = 0;
  }

  /** Drops the open connection so the next send picks up changed settings. */
  reset(): void {
    this.transport?.close();
    this.transport = null;
    this.transportKey = '';
  }

  /** Opens a one-off connection and checks the server accepts the login. */
  async verify(server: MailServer): Promise<void> {
    if (!server.host) throw new Error('No mail server host set.');
    const probe = this.build(server);
    try {
      await probe.verify();
    } finally {
      probe.close();
    }
  }

  private connect(server: MailServer): Transporter {
    const key = JSON.stringify([server.host, server.port, server.secure, server.user, server.pass]);
    if (this.transport && this.transportKey === key) return this.transport;
    this.transport?.close();
    this.transportKey = key;
    this.transport = this.build(server);
    return this.transport;
  }

  private build(server: MailServer): Transporter {
    if (!server.host) {
      // No host configured. `jsonTransport` serialises the message and returns
      // it instead of opening a socket, so nothing is ever sent by accident
      // from a test run or a half-configured install.
      return createTransport({ jsonTransport: true });
    }

    const { host, port, secure, user, pass } = server;
    this.log.log(`Mail: ${user ? `${user}@` : ''}${host}:${port}${secure ? ' (TLS)' : ' (STARTTLS)'} [${server.source}]`);

    return createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {}),
      // A hung connection must not hold a sweep open indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
}
