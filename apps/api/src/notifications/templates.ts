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
  /** The document this concerns, e.g. "RCP-iphone18promax-26112025-10". */
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

  const area = facts.journey ? AREA[facts.journey.area] : null;
  const accent = area?.colour ?? INK;
  const soft = area?.soft ?? '#f1f5f9';

  // Two facts per row, as small cards: easier to scan on a phone than a list.
  const factCells = facts.facts.map(
    (f) => `
          <td width="50%" valign="top" style="padding:4px;">
            <div style="background:#f8fafc;border:1px solid ${RULE};border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};">${escape(f.label)}</div>
              <div style="font-size:14px;font-weight:700;color:${INK};margin-top:2px;">${escape(f.value)}</div>
            </div>
          </td>`,
  );
  const factRows = Array.from({ length: Math.ceil(factCells.length / 2) }, (_, i) =>
    `<tr>${factCells[i * 2]}${factCells[i * 2 + 1] ?? '<td width="50%"></td>'}</tr>`,
  ).join('');

  const lineRows = shown
    .map(
      (l) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${RULE};">
            <div style="font-size:14px;font-weight:600;color:${INK};">${escape(l.product)}</div>
            <div style="font-size:12px;color:${MUTED};font-family:monospace;margin-top:2px;">${escape(l.sku)}${l.detail ? ` &middot; ${escape(l.detail)}` : ''}</div>
          </td>
          <td align="right" valign="middle" style="padding:10px 12px;border-bottom:1px solid ${RULE};white-space:nowrap;">
            <span style="display:inline-block;min-width:28px;text-align:center;background:${soft};color:${accent};font-size:13px;font-weight:700;padding:4px 10px;border-radius:999px;">&times;${l.quantity.toLocaleString('en-GB')}</span>
          </td>
        </tr>`,
    )
    .join('');

  const tile = (value: string, label: string) => `
          <td width="50%" style="padding:4px;">
            <div style="background:${soft};border-radius:10px;padding:12px 14px;">
              <div style="font-size:24px;font-weight:800;color:${accent};line-height:1.1;">${value}</div>
              <div style="font-size:12px;color:${MUTED};margin-top:2px;">${label}</div>
            </div>
          </td>`;

  const preheader = [facts.alert, ...facts.facts.slice(0, 2).map((f) => `${f.label}: ${f.value}`)]
    .filter(Boolean)
    .join(' · ');

  const html = `<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 12px;background:#eef1f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;">
    <tr><td style="padding:0 4px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;background:${INK};border-radius:7px;color:#fff;font-size:13px;font-weight:800;">P</td>
        <td style="padding-left:8px;font-size:14px;font-weight:700;color:${INK};">Phone ERP</td>
      </tr></table>
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.06);">
    <tr>
      <td bgcolor="${accent}" style="padding:26px 24px 22px;background:${accent};background-image:linear-gradient(135deg,${accent} 0%,${INK} 140%);">
        ${area ? `<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#ffffff;background:rgba(255,255,255,.18);padding:4px 10px;border-radius:999px;">${area.icon}&nbsp; ${area.label}</div>` : ''}
        <div style="font-size:24px;font-weight:800;color:#ffffff;line-height:1.25;margin-top:12px;">${escape(facts.headline)}</div>
        <div style="margin-top:10px;"><span style="display:inline-block;font-size:13px;font-weight:700;color:${accent};background:#ffffff;font-family:monospace;padding:5px 10px;border-radius:6px;">${escape(facts.reference)}</span></div>
      </td>
    </tr>
    ${facts.journey ? renderJourney(facts.journey) : ''}
    ${
      facts.alert
        ? `<tr><td style="padding:12px 24px 0;">
             <div style="background:${ALERT_BG};border-left:4px solid ${ALERT};border-radius:6px;padding:12px 14px;font-size:14px;color:${ALERT};font-weight:600;">&#9888;&#65039;&nbsp; ${escape(facts.alert)}</div>
           </td></tr>`
        : ''
    }
    <tr><td style="padding:16px 20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${tile(totalUnits.toLocaleString('en-GB'), totalUnits === 1 ? 'unit' : 'units')}
        ${tile(facts.lines.length.toLocaleString('en-GB'), facts.lines.length === 1 ? 'product' : 'products')}
      </tr></table>
    </td></tr>
    ${factRows ? `<tr><td style="padding:4px 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${factRows}</table></td></tr>` : ''}
    <tr>
      <td style="padding:16px 24px 4px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:${MUTED};padding:0 0 6px;">What's inside</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${RULE};border-radius:8px;">
          ${lineRows}
        </table>
        ${hidden > 0 ? `<div style="font-size:12px;color:${MUTED};padding:8px 2px;">and ${hidden} more line${hidden === 1 ? '' : 's'} — open it in the app to see them all.</div>` : ''}
      </td>
    </tr>
    ${
      facts.link
        ? `<tr><td align="center" style="padding:20px 24px 26px;">
             <a href="${escape(facts.link)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:10px;">${escape(facts.linkLabel ?? 'Open in the app')} &rarr;</a>
           </td></tr>`
        : '<tr><td style="padding:8px;"></td></tr>'
    }
    <tr>
      <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid ${RULE};font-size:11px;color:${MUTED};text-align:center;">
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
