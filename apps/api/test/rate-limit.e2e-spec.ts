import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

/**
 * Rate limiting counts per account, not per address.
 *
 * A warehouse is one internet connection: keyed on IP, one picker working a
 * pallet used up the bucket for the whole building, office and till included.
 * Every request in this suite comes from the same address, which is exactly
 * the situation that used to collapse them all together.
 */
describe('Rate limiting', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;
  let previousLimit: string | undefined;

  beforeAll(async () => {
    // The suite-wide limit is enormous so nothing else trips over it; this
    // spec needs a ceiling it can actually reach.
    previousLimit = process.env.THROTTLE_LIMIT;
    process.env.THROTTLE_LIMIT = '8';
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
  });
  afterAll(async () => {
    await app.close();
    if (previousLimit === undefined) delete process.env.THROTTLE_LIMIT;
    else process.env.THROTTLE_LIMIT = previousLimit;
  });

  it('does not let one account exhaust the bucket for another', async () => {
    // Spend the admin's allowance well past the limit.
    let throttled = false;
    for (let i = 0; i < 20; i += 1) {
      const res = await as(app, admin).get('/api/v1/warehouses');
      if (res.status === 429) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);

    // Same machine, same address, different person: still working.
    await as(app, jean).get('/api/v1/warehouses').expect(200);
  });
});
