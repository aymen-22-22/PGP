import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, PASSWORD, as, createTestApp, login, seedFixture } from './helpers';

describe('Authentication (spec §23)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  it('signs in a valid user and returns their warehouse context', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.jean.email, password: PASSWORD })
      .expect(200);

    expect(res.body.user.name).toBe('Jean');
    expect(res.body.user.role).toBe('WAREHOUSE_USER');
    expect(res.body.user.warehouseId).toBe(fixture.france.id);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('sets an HTTP-only session cookie and a readable CSRF cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.jean.email, password: PASSWORD })
      .expect(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('perp_token='));
    const csrf = cookies.find((c) => c.startsWith('perp_csrf='));
    expect(session).toContain('HttpOnly');
    expect(csrf).not.toContain('HttpOnly');
  });

  it('rejects an invalid password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.jean.email, password: 'wrong-password-entirely' })
      .expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives the same error for an unknown address, revealing nothing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: PASSWORD })
      .expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a deactivated account', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.inactive.email, password: PASSWORD })
      .expect(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects unauthenticated access to protected endpoints', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inventory').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('invalidates existing tokens when the password changes', async () => {
    const token = await login(app, fixture.jean.email);
    await as(app, token).get('/api/v1/auth/me').expect(200);

    await as(app, token)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPassword456!' })
      .expect(200);

    await as(app, token).get('/api/v1/auth/me').expect(401);
    await login(app, fixture.jean.email, 'BrandNewPassword456!');
  });

  it('invalidates existing tokens when an admin deactivates the user', async () => {
    const adminToken = await login(app, fixture.admin.email);
    const jeanToken = await login(app, fixture.jean.email);

    await as(app, adminToken).patch(`/api/v1/users/${fixture.jean.id}`).send({ isActive: false }).expect(200);
    await as(app, jeanToken).get('/api/v1/auth/me').expect(401);
  });

  /**
   * A stale session cookie must never block signing in again. The cookie is
   * HttpOnly, so the page cannot clear it and "reload" does not help — a user in
   * that state would be locked out until they wiped site data by hand.
   */
  it('lets a user sign in while holding a stale session cookie and no CSRF cookie', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.jean.email, password: PASSWORD })
      .expect(200);

    const staleToken = (first.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('perp_token='))!
      .split(';')[0];

    // Present the session cookie but no CSRF cookie and no CSRF header.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', staleToken)
      .send({ email: fixture.jean.email, password: PASSWORD })
      .expect(200);

    expect(res.body.user.email).toBe(fixture.jean.email);
  });

  it('still enforces CSRF on authenticated state-changing requests', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.admin.email, password: PASSWORD })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('perp_token='))!.split(';')[0];

    // Cookie-authenticated, no X-CSRF-Token header: must be refused.
    const forged = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Cookie', sessionCookie)
      .send({ name: 'Forged', code: 'FRG', country: 'Nowhere' })
      .expect(403);
    expect(forged.body.code).toBe('FORBIDDEN');
    expect(forged.body.message).toContain('CSRF');

    // The same request with the matching header succeeds.
    const csrfCookie = cookies.find((c) => c.startsWith('perp_csrf='))!.split(';')[0];
    const csrfValue = csrfCookie.split('=')[1];
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Cookie', [sessionCookie, csrfCookie])
      .set('X-CSRF-Token', csrfValue)
      .send({ name: 'Legitimate', code: 'LGT', country: 'Nowhere' })
      .expect(201);
  });

  it('records logins and failures in the audit log without storing the password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fixture.jean.email, password: 'nope-not-this-one' })
      .expect(401);
    await login(app, fixture.jean.email);

    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('LOGIN_FAILED');
    expect(actions).toContain('LOGIN');
    expect(JSON.stringify(logs)).not.toContain('nope-not-this-one');
  });
});

describe('Login rate limiting (spec §23, §41)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;

  beforeAll(async () => {
    // Override the suite-wide relaxation so the limiter is actually exercised.
    process.env.THROTTLE_LOGIN_LIMIT = '5';
    ({ app, prisma } = await createTestApp());
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
  });
  afterAll(async () => {
    process.env.THROTTLE_LOGIN_LIMIT = '100000';
    await app.close();
  });

  it('blocks repeated login attempts from the same client', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.jean.email, password: 'wrong-password' });

    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) codes.push((await attempt()).status);

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes).toContain(429);
  });
});
