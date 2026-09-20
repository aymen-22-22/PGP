import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../common/tokens';
import type { AppConfig } from '../config/configuration';

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
  /** Only populated by the in-memory transport used in tests. */
  private readonly outbox: { to: string[]; subject: string; html: string; text: string }[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.mail.enabled;
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

    const transport = this.connect();
    await transport.sendMail({
      from: this.config.mail.from,
      // Recipients go in bcc: an operational email should not hand every
      // warehouse a list of everyone else's address.
      bcc: message.to,
      to: this.config.mail.from,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (this.isCapturing) this.outbox.push(message);
  }

  /** Messages captured in memory. Empty unless the capturing transport is in use. */
  sent(): readonly { to: string[]; subject: string; html: string; text: string }[] {
    return this.outbox;
  }

  clearSent(): void {
    this.outbox.length = 0;
  }

  private get isCapturing(): boolean {
    return !this.config.mail.host;
  }

  private connect(): Transporter {
    if (this.transport) return this.transport;

    if (this.isCapturing) {
      // No host configured. `jsonTransport` serialises the message and returns
      // it instead of opening a socket, so nothing is ever sent by accident
      // from a test run or a half-configured install.
      this.transport = createTransport({ jsonTransport: true });
      return this.transport;
    }

    const { host, port, secure, user, pass } = this.config.mail;
    this.log.log(`Mail: ${user ? `${user}@` : ''}${host}:${port}${secure ? ' (TLS)' : ' (STARTTLS)'}`);

    this.transport = createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {}),
      // A hung connection must not hold a sweep open indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transport;
  }
}
