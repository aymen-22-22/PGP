import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';
import request from 'supertest';

/**
 * A signed-in account is never rate limited; login still is.
 *
 * Throttling authenticated traffic cost more than it bought — a picker
 * working a pallet, or several staff behind one connection, hit the ceiling
 * doing their job and the site stopped answering. Login keeps its own strict
 * bucket, because that one guards a password and anyone can knock on it.
 */
describe('Rate limiting', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // The suite-wide limits are enormous so nothing trips over them; this spec
    // needs ceilings it can actually reach.
    previous.limit = process.env.THROTTLE_LIMIT;
    previous.login = process.env.THROTTLE_LOGIN_LIMIT;
    process.env.THROTTLE_LIMIT = '5';
    process.env.THROTTLE_LOGIN_LIMIT = '3';
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
  });
  afterAll(async () => {
    await app.close();
    for (const [key, name] of [
      ['limit', 'THROTTLE_LIMIT'],
      ['login', 'THROTTLE_LOGIN_LIMIT'],
    ] as const) {
      if (previous[key] === undefined) delete process.env[name];
      else process.env[name] = previous[key]!;
    }
  });

  it('never throttles a signed-in account, however hard it works', async () => {
    // Well past a limit of 5: a pallet is hundreds of scans in a few minutes.
    for (let i = 0; i < 30; i += 1) {
      await as(app, admin).get('/api/v1/warehouses').expect(200);
    }
  });

  it('still throttles repeated login attempts', async () => {
    let throttled = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.admin.email, password: 'WrongPassword123!' });
      if (res.status === 429) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);
  });
});
