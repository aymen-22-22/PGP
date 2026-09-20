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

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px 12px;background:#eef0f4;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:6px;">
    <tr>
      <td style="padding:20px 24px;border-bottom:2px solid ${INK};">
        <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};">Phone ERP</div>
        <div style="font-size:19px;font-weight:700;color:${INK};line-height:1.3;margin-top:2px;">${escape(facts.headline)}</div>
        <div style="font-size:13px;color:${MUTED};font-family:monospace;margin-top:2px;">${escape(facts.reference)}</div>
      </td>
    </tr>
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
             <a href="${escape(facts.link)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:5px;">${escape(facts.linkLabel ?? 'Open in the app')}</a>
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
