import { INestApplication } from '@nestjs/common';
import { MailerService } from '../src/notifications/mailer.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture, testImei } from './helpers';

/**
 * Operational email.
 *
 * The rules worth pinning are the ones about staying out of the way: a mail
 * server that is down must delay a message, never lose one, and must never
 * prevent goods from being received. Nothing here sends anything — with no
 * SMTP host configured the transport collects messages in memory.
 */
describe('Notifications', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let notifications: NotificationsService;
  let fixture: Fixture;
  let admin: string;

  const receive = (imeis: string[]) =>
    as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial: true });

  const queued = () => prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });

  /**
   * Waits for anything already on its way, then forgets it.
   *
   * `notify()` starts a sweep without waiting for it — the HTTP response must
   * not hang on a mail server — so an earlier message can otherwise land in the
   * capture after the test has cleared it.
   */
  const drainAndClear = async () => {
    await notifications.flush();
    mailer.clearSent();
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    mailer = app.get(MailerService);
    notifications = app.get(NotificationsService);
  });
  beforeEach(async () => {
    // notify() kicks a sweep without waiting for it, so drain anything still
    // in flight from the previous test before wiping the tables under it.
    await notifications.flush();
    await prisma.truncateAll();
    mailer.clearSent();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('ordering', () => {
    it('tells the receiving warehouse that goods are on the way', async () => {
      await as(app, admin)
        .post('/api/v1/purchases')
        .send({
          supplierId: fixture.supplier.id,
          warehouseId: fixture.france.id,
          items: [{ productId: fixture.product.id, quantity: 4, unitPrice: '900.00' }],
        })
        .expect(201);
      await notifications.flush();

      const [row] = await prisma.notification.findMany({ where: { event: 'PURCHASE_ORDERED' } });
      expect(row.recipients).toContain(fixture.jean.email);
      expect(row.recipients).not.toContain(fixture.carlos.email);
      expect(row.recipients).not.toContain(fixture.admin.email);

      const [message] = mailer.sent();
      expect(message.subject).toMatch(/^Goods on the way · PO-/);
      expect(message.text).toContain('4 units on the way to France Warehouse');
      expect(message.text).toContain('Ordered by: Admin');
    });
  });

  describe('goods-in', () => {
    it('emails what arrived, with the products, who and when', async () => {
      // The whole order, so this is a clean receipt rather than a short one.
      await receive(Array.from({ length: 10 }, (_, i) => testImei(i + 1))).expect(200);
      await notifications.flush();

      const [message] = mailer.sent();
      expect(message.subject).toMatch(/^Goods received · RCP-/);
      expect(message.subject).toContain('Central Warehouse');

      // The facts a reader needs without opening the app.
      expect(message.text).toContain('iPhone 18 Pro Max 256GB Black');
      expect(message.text).toContain('APL-IP18PM-256-BLK');
      expect(message.text).toContain('Received by: Admin');
      expect(message.text).toContain('Total units: 10');
      expect(message.html).toContain('<table');
    });

    it('says so, loudly, when the delivery is short', async () => {
      // Ten were ordered; three turned up.
      await receive([testImei(1), testImei(2), testImei(3)]).expect(200);
      await notifications.flush();

      const [message] = mailer.sent();
      expect(message.subject).toMatch(/^Short delivery/);
      expect(message.text).toContain('7 units short');
      expect(message.text).toContain('Expected: 10 units');
      expect(message.text).toContain('Received: 3 units');
    });

    it('summarises a large receipt instead of listing every unit', async () => {
      const many = Array.from({ length: 10 }, (_, i) => testImei(i + 1));
      await receive(many).expect(200);
      await notifications.flush();

      const [message] = mailer.sent();
      // One line per product, not one per handset.
      expect(message.text).toContain('10 IMEIs scanned');
      expect(message.text).not.toContain(testImei(5));
    });
  });

  describe('shipments', () => {
    const buildTransfer = async () => {
      await receive([testImei(1), testImei(2), testImei(3), testImei(4)]).expect(200);
      const created = await as(app, admin)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.central.id,
          destinationWarehouseId: fixture.france.id,
          items: [{ productId: fixture.product.id, quantity: 2 }],
          imeis: [testImei(1), testImei(2)],
        })
        .expect(201);
      return created.body.id as string;
    };

    it('tells the far end that something is on its way', async () => {
      const transferId = await buildTransfer();
      await drainAndClear();

      await as(app, admin)
        .post(`/api/v1/transfers/${transferId}/ship`)
        .send({ carrier: 'DHL Road', trackingRef: 'DHL-0091' })
        .expect(200);
      await notifications.flush();

      const [message] = mailer.sent();
      expect(message.subject).toMatch(/^Shipment sent · SHP-/);
      expect(message.text).toContain('On its way to France Warehouse');
      expect(message.text).toContain('From: Central Warehouse');
      expect(message.text).toContain('Carrier: DHL Road');
      expect(message.text).toContain('Tracking: DHL-0091');
      expect(message.text).toContain('Sent by: Admin');
    });

    it('confirms arrival to both ends', async () => {
      const transferId = await buildTransfer();
      await as(app, admin).post(`/api/v1/transfers/${transferId}/ship`).send({}).expect(200);
      await drainAndClear();

      await as(app, admin)
        .post(`/api/v1/transfers/${transferId}/receive`)
        .send({ imeis: [testImei(1), testImei(2)] })
        .expect(200);
      await notifications.flush();

      const [message] = mailer.sent();
      expect(message.subject).toMatch(/^Shipment received · RCP-/);
      expect(message.text).toContain('Arrived at France Warehouse');
      expect(message.text).toContain('Received by: Admin');

      // Both warehouses' people, plus the administrator.
      const [row] = await prisma.notification.findMany({ where: { event: 'TRANSFER_RECEIVED' } });
      expect(row.recipients).toEqual(
        expect.arrayContaining([fixture.admin.email, fixture.jean.email]),
      );
    });
  });

  describe('when the mail server is unreachable', () => {
    it('queues the message rather than losing it, and the goods are still received', async () => {
      jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('ECONNREFUSED smtp:587'));

      await receive([testImei(1)]).expect(200);
      // The attempt is the one notify() already started; flush() here would
      // race it and could become a second attempt.
      await notifications.settled();

      const [row] = await queued();
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
      expect(row.lastError).toContain('ECONNREFUSED');

      // The receipt exists regardless: mail is not part of the transaction.
      const devices = await prisma.device.count();
      expect(devices).toBe(1);
    });

    it('sends it on the next sweep once the server is back', async () => {
      jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('ECONNREFUSED smtp:587'));
      await receive([testImei(1)]).expect(200);
      await notifications.settled();

      jest.restoreAllMocks();
      const result = await notifications.flush();

      expect(result.sent).toBe(1);
      const [row] = await queued();
      expect(row.status).toBe('SENT');
      expect(row.sentAt).not.toBeNull();
    });

    it('gives up eventually, and keeps the reason', async () => {
      jest.spyOn(mailer, 'send').mockRejectedValue(new Error('550 mailbox unavailable'));
      await receive([testImei(1)]).expect(200);

      // MAIL_MAX_ATTEMPTS defaults to 6.
      for (let i = 0; i < 6; i++) await notifications.flush();

      const [row] = await queued();
      expect(row.status).toBe('FAILED');
      expect(row.attempts).toBe(6);
      expect(row.lastError).toContain('550');
      jest.restoreAllMocks();
    });
  });

  describe('who gets told', () => {
    it('leaves out anyone who has turned these off', async () => {
      await prisma.user.update({
        where: { id: fixture.admin.id },
        data: { notifyByEmail: false },
      });

      await receive([testImei(1)]).expect(200);

      // The administrator is the only person attached to this warehouse, so
      // with them opted out there is nobody to tell and nothing is queued.
      expect(await queued()).toHaveLength(0);
    });

    it('leaves out people who have been deactivated', async () => {
      await prisma.user.updateMany({ where: { email: fixture.jean.email }, data: { isActive: false } });

      await receive([testImei(1)]).expect(200);
      const [row] = await queued();

      expect(row.recipients).toContain(fixture.admin.email);
      expect(row.recipients).not.toContain(fixture.jean.email);
    });

    it('never puts one warehouse’s addresses in front of another', async () => {
      await receive([testImei(1)]).expect(200);
      await notifications.flush();

      // Recipients travel in bcc, so nobody learns anyone else's address.
      const [message] = mailer.sent();
      expect(message.to.length).toBeGreaterThan(0);
    });
  });

  describe('the admin view', () => {
    it('shows what was sent and what is stuck', async () => {
      jest.spyOn(mailer, 'send').mockRejectedValue(new Error('ECONNREFUSED'));
      await receive([testImei(1)]).expect(200);
      await notifications.flush();
      jest.restoreAllMocks();

      const res = await as(app, admin).get('/api/v1/notifications').expect(200);
      expect(res.body.summary.pending).toBe(1);
      expect(res.body.data[0]).toMatchObject({ event: 'SHORT_DELIVERY', status: 'PENDING' });
    });

    it('is administrators only', async () => {
      const jean = await login(app, fixture.jean.email);
      await as(app, jean).get('/api/v1/notifications').expect(403);
    });
  });
});
