import type { NotificationEvent } from '@prisma/client';

/**
 * The messages themselves.
 *
 * Written as tables with inline styles because that is what mail clients
 * actually render — Outlook has no flexbox and strips most of a stylesheet, so
 * anything cleverer arrives as a column of unstyled text. Every message also
 * carries a plain-text alternative: some people read mail that way, and a
 * message with no text part scores as spam.
 */

export interface LineItem {
  product: string;
  sku: string;
  quantity: number;
  /** Present for phones; accessories have no unit to name. */
  detail?: string | null;
}

export interface MessageFacts {
  /** What happened, in the reader's words. */
  headline: string;
  /** The document this concerns, e.g. "RCP-2026-000014". */
  reference: string;
  /** Rows of label/value shown above the products. */
  facts: { label: string; value: string }[];
  lines: LineItem[];
  /** Shown as a warning strip when something needs attention. */
  alert?: string | null;
  /** Where to open the document in the app. */
  link?: string | null;
  linkLabel?: string;
  /** Drawn above the facts: where the goods are, and which steps are done. */
  journey?: Journey;
}

export type Area = 'buying' | 'moving' | 'selling';

export interface JourneyPlace {
  name: string;
  /** Warehouse code like "ES-01"; its prefix picks the flag. */
  code?: string | null;
}

export interface Journey {
  area: Area;
  from?: JourneyPlace;
  to?: JourneyPlace;
  /** 0 = not left, 1 = arrived. */
  progress?: number;
  steps: { label: string; state: 'done' | 'current' | 'todo'; note?: string | null }[];
}

/** The same colours as the areas in the app, so the mail looks like it came from it. */
const AREA: Record<Area, { colour: string; soft: string; label: string; icon: string }> = {
  buying: { colour: '#2563eb', soft: '#eff6ff', label: 'Buying', icon: '&#128722;' },
  moving: { colour: '#ea580c', soft: '#fff7ed', label: 'Moving stock', icon: '&#128666;' },
  selling: { colour: '#059669', soft: '#ecfdf5', label: 'Selling', icon: '&#128176;' },
};

const FLAGS: Record<string, string> = {
  FR: '&#127467;&#127479;',
  ES: '&#127466;&#127480;',
  DZ: '&#127465;&#127487;',
};

const flag = (place: JourneyPlace): string => {
  const prefix = place.code?.match(/^([A-Z]{2})-/)?.[1];
  return (prefix && FLAGS[prefix]) || '&#127981;';
};

const DONE = '#16a34a';
const TODO = '#cbd5e1';

function renderJourney(j: Journey): string {
  const area = AREA[j.area];
  const pct = Math.round(Math.max(0, Math.min(1, j.progress ?? 0)) * 100);

  const route =
    j.from && j.to
      ? `
    <tr><td style="padding:20px 24px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="96" align="center" valign="top" style="font-size:12px;font-weight:700;color:${INK};">
            <div style="font-size:30px;line-height:1;">${flag(j.from)}</div>
            <div style="margin-top:4px;">${escape(j.from.name)}</div>
          </td>
          <td valign="middle" style="padding:0 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                ${pct > 0 ? `<td width="${pct}%" style="height:6px;background:${area.colour};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>` : ''}
                <td width="32" align="center" style="font-size:22px;line-height:1;">${pct >= 100 ? '&#9989;' : '&#128666;'}</td>
                ${pct < 100 ? `<td style="height:6px;background:${TODO};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>` : ''}
              </tr>
            </table>
          </td>
          <td width="96" align="center" valign="top" style="font-size:12px;font-weight:700;color:${INK};">
            <div style="font-size:30px;line-height:1;">${flag(j.to)}</div>
            <div style="margin-top:4px;">${escape(j.to.name)}</div>
          </td>
        </tr>
      </table>
    </td></tr>`
      : '';

  const width = Math.floor(100 / j.steps.length);
  const steps = j.steps
    .map((step, i) => {
      const bg = step.state === 'done' ? DONE : step.state === 'current' ? area.colour : '#ffffff';
      const fg = step.state === 'todo' ? '#94a3b8' : '#ffffff';
      const border = step.state === 'todo' ? TODO : bg;
      const mark = step.state === 'done' ? '&#10003;' : String(i + 1);
      return `
        <td width="${width}%" align="center" valign="top" style="padding:0 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
            <td width="30" height="30" align="center" valign="middle" style="width:30px;height:30px;border-radius:15px;background:${bg};border:2px solid ${border};color:${fg};font-size:14px;font-weight:700;">${mark}</td>
          </tr></table>
          <div style="margin-top:6px;font-size:12px;font-weight:700;color:${step.state === 'todo' ? '#94a3b8' : INK};">${escape(step.label)}</div>
          ${step.note ? `<div style="font-size:11px;color:${MUTED};margin-top:2px;">${escape(step.note)}</div>` : ''}
        </td>`;
    })
    .join('');

  return `${route}
    <tr><td style="padding:16px 24px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${area.soft};border-radius:8px;">
        <tr><td style="padding:14px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${steps}</tr></table>
        </td></tr>
      </table>
    </td></tr>`;
}

const INK = '#1a2028';
const MUTED = '#5b6675';
const RULE = '#dfe3ea';
const ALERT = '#8a3b22';
const ALERT_BG = '#fdf1ec';

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);

/** How many product lines to print before summarising the rest. */
const MAX_LINES = 25;

export function renderMessage(facts: MessageFacts): { html: string; text: string } {
  const shown = facts.lines.slice(0, MAX_LINES);
  const hidden = facts.lines.length - shown.length;
  const totalUnits = facts.lines.reduce((sum, l) => sum + l.quantity, 0);

  const factRows = facts.facts
    .map(
      (f) => `
        <tr>
          <td style="padding:4px 16px 4px 0;color:${MUTED};font-size:13px;white-space:nowrap;">${escape(f.label)}</td>
          <td style="padding:4px 0;color:${INK};font-size:13px;font-weight:600;">${escape(f.value)}</td>
        </tr>`,
    )
    .join('');

  const lineRows = shown
    .map(
      (l, i) => `
        <tr style="background:${i % 2 ? '#f7f8fa' : '#ffffff'};">
          <td style="padding:8px 10px;border-bottom:1px solid ${RULE};font-size:13px;color:${INK};">
            ${escape(l.product)}
            ${l.detail ? `<div style="color:${MUTED};font-size:12px;font-family:monospace;">${escape(l.detail)}</div>` : ''}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid ${RULE};font-size:12px;color:${MUTED};font-family:monospace;white-space:nowrap;">${escape(l.sku)}</td>
          <td align="right" style="padding:8px 10px;border-bottom:1px solid ${RULE};font-size:13px;color:${INK};font-weight:600;">${l.quantity.toLocaleString('en-GB')}</td>
        </tr>`,
    )
    .join('');

  const area = facts.journey ? AREA[facts.journey.area] : null;
  const accent = area?.colour ?? INK;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px 12px;background:#eef0f4;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:10px;">
    <tr>
      <td style="padding:22px 24px;background:${accent};border-radius:10px 10px 0 0;">
        <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,.8);">Phone ERP${area ? ` &middot; ${area.label}` : ''}</div>
        <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;margin-top:4px;">${area ? `${area.icon}&nbsp; ` : ''}${escape(facts.headline)}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.85);font-family:monospace;margin-top:4px;">${escape(facts.reference)}</div>
      </td>
    </tr>
    ${facts.journey ? renderJourney(facts.journey) : ''}
    ${
      facts.alert
        ? `<tr><td style="padding:12px 24px;background:${ALERT_BG};border-bottom:1px solid ${RULE};">
             <div style="font-size:13px;color:${ALERT};font-weight:600;">${escape(facts.alert)}</div>
           </td></tr>`
        : ''
    }
    <tr>
      <td style="padding:16px 24px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">${factRows}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 24px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <th align="left" style="padding:6px 10px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${RULE};">Product</th>
            <th align="left" style="padding:6px 10px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${RULE};">SKU</th>
            <th align="right" style="padding:6px 10px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${RULE};">Qty</th>
          </tr>
          ${lineRows}
          <tr>
            <td colspan="2" style="padding:8px 10px;font-size:13px;font-weight:700;color:${INK};">Total</td>
            <td align="right" style="padding:8px 10px;font-size:13px;font-weight:700;color:${INK};">${totalUnits.toLocaleString('en-GB')}</td>
          </tr>
        </table>
        ${hidden > 0 ? `<div style="font-size:12px;color:${MUTED};padding:6px 10px;">and ${hidden} more line${hidden === 1 ? '' : 's'} — open it in the app to see them all.</div>` : ''}
      </td>
    </tr>
    ${
      facts.link
        ? `<tr><td style="padding:12px 24px 24px;">
             <a href="${escape(facts.link)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:8px;">${escape(facts.linkLabel ?? 'Open in the app')}</a>
           </td></tr>`
        : ''
    }
    <tr>
      <td style="padding:14px 24px;border-top:1px solid ${RULE};font-size:11px;color:${MUTED};">
        Sent automatically when this happened. Turn these off under More → your account.
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    facts.headline,
    facts.reference,
    '',
    ...(facts.journey
      ? [
          ...(facts.journey.from && facts.journey.to ? [`${facts.journey.from.name} -> ${facts.journey.to.name}`] : []),
          facts.journey.steps.map((st) => `${st.state === 'done' ? '[x]' : st.state === 'current' ? '[>]' : '[ ]'} ${st.label}`).join('  '),
          '',
        ]
      : []),
    ...(facts.alert ? [`! ${facts.alert}`, ''] : []),
    ...facts.facts.map((f) => `${f.label}: ${f.value}`),
    '',
    ...shown.map((l) => `  ${String(l.quantity).padStart(5)}  ${l.product} (${l.sku})${l.detail ? ` — ${l.detail}` : ''}`),
    ...(hidden > 0 ? [`  … and ${hidden} more line${hidden === 1 ? '' : 's'}`] : []),
    '',
    `Total units: ${totalUnits.toLocaleString('en-GB')}`,
    ...(facts.link ? ['', facts.link] : []),
    '',
    'Sent automatically when this happened. Turn these off under More → your account.',
  ].join('\n');

  return { html, text };
}

/** The subject line, which is most of what gets read. */
export function subjectFor(event: NotificationEvent, reference: string, warehouse: string): string {
  const titles: Record<NotificationEvent, string> = {
    PURCHASE_RECEIVED: 'Goods received',
    SHORT_DELIVERY: 'Short delivery',
    RECEIPT_VALIDATED: 'Receipt validated',
    TRANSFER_SHIPPED: 'Shipment sent',
    TRANSFER_RECEIVED: 'Shipment received',
  };
  return `${titles[event]} · ${reference} · ${warehouse}`;
}
