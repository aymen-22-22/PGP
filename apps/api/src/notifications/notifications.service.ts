import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationEvent, NotificationStatus, Role } from '@prisma/client';
import { APP_CONFIG } from '../common/tokens';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { renderMessage, subjectFor, type MessageFacts } from './templates';

/**
 * Who hears about what.
 *
 * Deliberately narrow. An operational mailbox that fills with things the reader
 * cannot act on gets filtered within a week, and then the one message that
 * mattered is filtered too.
 */
const AUDIENCE: Record<NotificationEvent, { admins: boolean; warehouses: 'source' | 'destination' | 'both' }> = {
  // Someone ordered these; the warehouse that booked them in already knows.
  PURCHASE_RECEIVED: { admins: true, warehouses: 'destination' },
  // Money. Whoever can chase the supplier needs to see it.
  SHORT_DELIVERY: { admins: true, warehouses: 'destination' },
  RECEIPT_VALIDATED: { admins: true, warehouses: 'destination' },
  // The far end needs to expect it; the near end does not need telling twice.
  TRANSFER_SHIPPED: { admins: true, warehouses: 'destination' },
  // The sender wants to know it arrived.
  TRANSFER_RECEIVED: { admins: true, warehouses: 'both' },
};

export interface NotifyInput {
  event: NotificationEvent;
  reference: string;
  warehouseName: string;
  /** The warehouse the goods are arriving at, or being sent from. */
  destinationWarehouseId?: string | null;
  sourceWarehouseId?: string | null;
  referenceType?: string;
  referenceId?: string;
  facts: Omit<MessageFacts, 'headline' | 'reference'> & { headline: string };
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificationsService.name);
  private sweep: NodeJS.Timeout | null = null;
  /** The sweep currently running, if any. */
  private inFlight: Promise<{ sent: number; failed: number }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.mail.enabled) return;
    // A plain interval rather than a scheduler dependency: one queue, one
    // worker, and shared hosting has nowhere to put a job runner anyway.
    this.sweep = setInterval(() => void this.flush(), this.config.mail.sweepMs);
    this.sweep.unref();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  /**
   * Records something worth telling people about.
   *
   * Never throws. This is called after the business transaction has already
   * committed, so anything that goes wrong here must stay here — a receipt is
   * not un-received because the mail server was unreachable.
   */
  async notify(input: NotifyInput): Promise<void> {
    if (!this.config.mail.enabled) return;

    try {
      const recipients = await this.recipientsFor(input);
      if (recipients.length === 0) return;

      const { html, text } = renderMessage({ ...input.facts, reference: input.reference });

      await this.prisma.notification.create({
        data: {
          event: input.event,
          subject: subjectFor(input.event, input.reference, input.warehouseName),
          html,
          text,
          recipients,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          warehouseId: input.destinationWarehouseId ?? input.sourceWarehouseId ?? null,
        },
      });

      // Try immediately; the sweep is the safety net, not the normal path.
      void this.flush();
    } catch (error) {
      this.log.error(`Could not queue ${input.event} for ${input.reference}: ${String(error)}`);
    }
  }

  /**
   * Sends what is waiting. Safe to call at any time; only one runs at once.
   *
   * A caller arriving mid-sweep waits for it rather than being told nothing
   * happened — "0 sent" while a sweep is halfway through is a lie, and it is
   * the answer a caller is most likely to act on.
   */
  async flush(): Promise<{ sent: number; failed: number }> {
    if (!this.config.mail.enabled) return { sent: 0, failed: 0 };
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runSweep().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runSweep(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    const pending = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const message of pending) {
      try {
        await this.mailer.send({
          to: message.recipients,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        // updateMany, not update: a row that has been cleared out from under
        // the sweep is not an error, and a throw here would abandon the rest
        // of the batch.
        await this.prisma.notification.updateMany({
          where: { id: message.id },
          data: { status: NotificationStatus.SENT, sentAt: new Date(), attempts: { increment: 1 } },
        });
        sent += 1;
      } catch (error) {
        const attempts = message.attempts + 1;
        // Given up on, but kept: a row that says why it never arrived is worth
        // more than a row that quietly disappeared.
        const exhausted = attempts >= this.config.mail.maxAttempts;
        await this.prisma.notification.updateMany({
          where: { id: message.id },
          data: {
            attempts,
            lastError: String(error).slice(0, 500),
            status: exhausted ? NotificationStatus.FAILED : NotificationStatus.PENDING,
          },
        });
        failed += 1;
        if (exhausted) {
          this.log.error(`Giving up on ${message.event} ${message.subject}: ${String(error)}`);
        }
      }
    }

    return { sent, failed };
  }

  /**
   * The addresses, resolved now rather than at send time.
   *
   * Someone who leaves the company between the event and a retry should not
   * receive it, and someone who joins should not receive an old one.
   */
  private async recipientsFor(input: NotifyInput): Promise<string[]> {
    const audience = AUDIENCE[input.event];
    const warehouseIds: string[] = [];
    if (audience.warehouses === 'destination' || audience.warehouses === 'both') {
      if (input.destinationWarehouseId) warehouseIds.push(input.destinationWarehouseId);
    }
    if (audience.warehouses === 'source' || audience.warehouses === 'both') {
      if (input.sourceWarehouseId) warehouseIds.push(input.sourceWarehouseId);
    }

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        notifyByEmail: true,
        OR: [
          ...(audience.admins ? [{ role: Role.ADMIN }] : []),
          ...(warehouseIds.length ? [{ warehouseId: { in: warehouseIds } }] : []),
        ],
      },
      select: { email: true },
    });

    return [...new Set(users.map((u) => u.email))].sort();
  }
}
