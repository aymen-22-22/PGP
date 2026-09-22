import { Socket } from 'node:net';

/**
 * Raw ESC/POS bytes for one unit label, printed by the thermal printer's own
 * firmware rather than rasterised here — the QR command set (Epson's `GS ( k`,
 * copied by nearly every ESC/POS-compatible thermal printer sold for retail)
 * produces a sharper code than any bitmap this server could send, and needs
 * no image library on a shared host that has none.
 */
export function buildLabelTicket(label: {
  code: string;
  product: { name: string; storage: string | null; color: string | null };
  sequence: number;
  of: number;
  purchaseNumber: string;
}): Buffer {
  const parts: Buffer[] = [];
  const text = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  const bytes = (...b: number[]) => parts.push(Buffer.from(b));

  bytes(0x1b, 0x40); // ESC @ — initialise
  bytes(0x1b, 0x61, 0x01); // ESC a 1 — center align

  bytes(0x1b, 0x21, 0x08); // ESC ! — emphasized text for the name
  text(label.product.name.slice(0, 40));
  bytes(0x0a);
  bytes(0x1b, 0x21, 0x00); // back to normal text

  const subtitle = [label.product.storage, label.product.color].filter(Boolean).join(' / ');
  if (subtitle) {
    text(subtitle);
    bytes(0x0a);
  }
  bytes(0x0a);

  // --- QR code (Epson ESC/POS "GS ( k" model 2, widely cloned) ---
  const data = Buffer.from(label.code, 'utf8');
  const storeLen = data.length + 3;
  bytes(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // model 2
  bytes(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x08); // module size 8 dots
  bytes(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // error correction level M
  bytes(0x1d, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30);
  parts.push(data);
  bytes(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // print the stored QR

  bytes(0x0a);
  bytes(0x1b, 0x21, 0x10); // double-height for the human-readable code
  text(label.code);
  bytes(0x0a);
  bytes(0x1b, 0x21, 0x00);

  text(`${label.sequence}/${label.of} - ${label.purchaseNumber}`);
  bytes(0x0a, 0x0a, 0x0a);

  bytes(0x1d, 0x56, 0x42, 0x00); // GS V B 0 — feed and partial cut

  return Buffer.concat(parts);
}

/**
 * Opens a raw TCP connection to the printer (the "AppSocket"/JetDirect port
 * nearly every network thermal or label printer answers on, conventionally
 * 9100) and writes the ticket. Not reachable if the API host and the
 * printer are not on routable networks — a shared-hosting API box generally
 * cannot reach a shop's LAN printer directly; this is meant for a
 * self-hosted or on-premises deployment where it can.
 */
export function printToNetworkPrinter(host: string, port: number, payload: Buffer, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => fail(new Error(`Timed out connecting to ${host}:${port}.`)));
    socket.once('error', (err) => fail(err));

    socket.connect(port, host, () => {
      socket.write(payload, (err) => {
        if (err) return fail(err);
        socket.end();
      });
    });
    socket.once('close', () => resolve());
  });
}

/** "192.168.1.50:9100" → { host, port }, or throws for anything else. */
export function parseHostPort(address: string): { host: string; port: number } {
  const match = /^([^:]+):(\d{1,5})$/.exec(address.trim());
  if (!match) throw new Error('Printer address must be host:port, e.g. 192.168.1.50:9100.');
  const port = Number(match[2]);
  if (port < 1 || port > 65535) throw new Error('Printer port must be between 1 and 65535.');
  return { host: match[1], port };
}
