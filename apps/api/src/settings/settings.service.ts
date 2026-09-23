import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG } from '../common/tokens';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Encrypted at rest; never sent back to the browser. */
  passEnc: string | null;
  from: string;
  enabled: boolean;
}

export interface AlertSettings {
  enabled: boolean;
  recipients: string[];
  /** Log time of the last entry already reported, so nothing is sent twice. */
  cursor: string | null;
  lastSentAt: string | null;
}

/**
 * Settings an administrator changes from the app.
 *
 * Kept small and cached for a few seconds: the mailer asks on every send and
 * the alert sweep every minute, and neither needs a round trip each time.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { at: number; value: unknown }>();
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    // Derived from the JWT secret, which the server already guards: a copy of
    // the database alone does not give away the mail password.
    this.key = createHash('sha256').update(`${config.jwt.secret}:app-settings`).digest();
  }

  async get<T>(key: string): Promise<T | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10_000) return hit.value as T | null;
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const value = (row?.value ?? null) as T | null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async set<T>(key: string, value: T, userId?: string): Promise<void> {
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: json, updatedById: userId ?? null },
      update: { value: json, updatedById: userId ?? null },
    });
    this.cache.set(key, { at: Date.now(), value });
  }

  async remove(key: string): Promise<void> {
    await this.prisma.appSetting.deleteMany({ where: { key } });
    this.cache.delete(key);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }

  decrypt(sealed: string): string {
    const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
  }
}
