import { EncodeHintType, QRCodeDecoderErrorCorrectionLevel as ErrorCorrectionLevel, QRCodeEncoder } from '@zxing/library';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PdfLabel {
  code: string;
  name: string;
  subtitle: string;
  footer: string;
}

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number) => mm * PT_PER_MM;
const BLACK = rgb(0, 0, 0);

/**
 * Unit labels as a PDF whose pages are exactly the label size.
 *
 * Phone browsers ignore the CSS `@page` size — iOS Safari always, Android
 * often — and print the labels onto A4, shrunk or cut. A PDF carries its own
 * page size, and every phone's print system honours that, so on a phone this
 * is what gets printed instead of the web page.
 */
export async function buildLabelPdf(labels: PdfLabel[], widthMm: number, heightMm: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const qrMm = heightMm * 0.68;
  const leftMm = 1.5;
  const gapMm = 2;
  const textX = leftMm + qrMm + gapMm;
  const textWidth = pt(widthMm - textX - 1.2);

  for (const raw of labels) {
    const label = {
      code: latin(raw.code),
      name: latin(raw.name),
      subtitle: latin(raw.subtitle),
      footer: latin(raw.footer),
    };
    const page = doc.addPage([pt(widthMm), pt(heightMm)]);
    drawQr(page, label.code, pt(leftMm), pt((heightMm - qrMm) / 2), pt(qrMm));

    const nameSize = pt(heightMm * 0.075);
    const subSize = pt(heightMm * 0.06);
    const footSize = pt(heightMm * 0.055);
    const codeSize = fitSize(bold, label.code, textWidth, pt(heightMm * 0.11));

    const nameLines = wrap(bold, label.name, nameSize, textWidth, 3);
    const block: { text: string; font: PDFFont; size: number }[] = [
      ...nameLines.map((text) => ({ text, font: bold, size: nameSize })),
      ...(label.subtitle ? [{ text: fit(regular, label.subtitle, subSize, textWidth), font: regular, size: subSize }] : []),
      { text: label.code, font: bold, size: codeSize },
      { text: fit(regular, label.footer, footSize, textWidth), font: regular, size: footSize },
    ];

    const lineGap = 1.18;
    const total = block.reduce((sum, l) => sum + l.size * lineGap, 0);
    let y = (pt(heightMm) + total) / 2;
    for (const line of block) {
      y -= line.size * lineGap;
      page.drawText(line.text, { x: pt(textX), y: y + line.size * 0.2, size: line.size, font: line.font, color: BLACK });
    }
  }

  return doc.save();
}

/** The QR as filled rectangles — one per horizontal run, so a page stays small. */
function drawQr(page: PDFPage, value: string, x: number, y: number, size: number): void {
  const hints = new Map([[EncodeHintType.MARGIN, 0]]);
  const matrix = QRCodeEncoder.encode(value, ErrorCorrectionLevel.M, hints).getMatrix();
  const n = matrix.getWidth();
  const cell = size / n;
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (matrix.get(col, row) !== 1) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && matrix.get(col, row) === 1) col++;
      page.drawRectangle({
        x: x + start * cell,
        y: y + size - (row + 1) * cell,
        // A hair wider than the cell, so no white seam shows between runs.
        width: (col - start) * cell + 0.05,
        height: cell + 0.05,
        color: BLACK,
      });
    }
  }
}

/** The built-in PDF fonts only cover Latin-1; anything else would stop the whole file. */
const latin = (text: string): string =>
  text.replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2026\u00B7]/g, '').replace(/\s+/g, ' ').trim();

function fitSize(font: PDFFont, text: string, width: number, max: number): number {
  const at1 = font.widthOfTextAtSize(text, 1);
  return Math.max(4, Math.min(max, width / at1));
}

function fit(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function wrap(font: PDFFont, text: string, size: number, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines.map((l) => fit(font, l, size, width));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fit(font, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, size, width);
  return kept;
}
