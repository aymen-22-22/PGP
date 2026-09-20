export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  /** Interface to bind. Loopback when something else terminates TLS in front. */
  host: string;
  apiPrefix: string;
  databaseUrl: string;
  jwt: { secret: string; expiresIn: string };
  cookie: {
    name: string;
    csrfName: string;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
  };
  cors: { origins: string[] };
  frontendUrl: string;
  receiving: { requireValidation: boolean; allowPartial: boolean };
  imei: { enforceChecksum: boolean };
  swaggerEnabled: boolean;
  trustProxy: boolean;
  /** Directory of the built web app to serve alongside the API, if any. */
  webRoot: string | null;
  /** Where uploaded product photos are written and served from. */
  uploads: { dir: string; maxBytes: number };
  mail: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    /** Milliseconds between sweeps of the queue. */
    sweepMs: number;
    maxAttempts: number;
  };
  throttle: { ttlMs: number; limit: number; loginLimit: number };
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfiguration(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  const isProd = nodeEnv === 'production';

  // REQUIRE_RECEIPT_VALIDATION and AUTO_VALIDATE_RECEIPT are two views of the same
  // switch; the explicit REQUIRE_ flag wins when both are set.
  const requireValidation = process.env.REQUIRE_RECEIPT_VALIDATION
    ? bool(process.env.REQUIRE_RECEIPT_VALIDATION, false)
    : !bool(process.env.AUTO_VALIDATE_RECEIPT, true);

  const corsOrigins = (process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    databaseUrl: process.env.DATABASE_URL ?? '',
    jwt: {
      secret: process.env.JWT_SECRET ?? '',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    },
    cookie: {
      name: process.env.AUTH_COOKIE_NAME ?? 'perp_token',
      csrfName: process.env.CSRF_COOKIE_NAME ?? 'perp_csrf',
      secure: bool(process.env.COOKIE_SECURE, isProd),
      sameSite: (process.env.COOKIE_SAME_SITE as AppConfig['cookie']['sameSite']) ?? 'lax',
      domain: process.env.COOKIE_DOMAIN || undefined,
    },
    cors: { origins: corsOrigins },
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    receiving: {
      requireValidation,
      allowPartial: bool(process.env.ALLOW_PARTIAL_RECEIPT, true),
    },
    imei: { enforceChecksum: bool(process.env.IMEI_ENFORCE_CHECKSUM, false) },
    swaggerEnabled: bool(process.env.SWAGGER_ENABLED, !isProd),
    trustProxy: bool(process.env.TRUST_PROXY, isProd),
    webRoot: process.env.SERVE_WEB_ROOT || null,
    uploads: {
      // Kept outside the web build, which is wiped and rewritten on every
      // deploy — product photos must survive that.
      dir: process.env.UPLOAD_DIR || './uploads',
      // A phone camera easily produces 5 MB. The browser shrinks pictures
      // before sending, so anything near this cap is a client that did not.
      maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 2_000_000),
    },
    mail: {
      // Off unless a host is configured, so an unconfigured install queues
      // nothing and behaves exactly as it did before.
      enabled: bool(process.env.MAIL_ENABLED, Boolean(process.env.SMTP_HOST)),
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 587),
      // 465 is implicit TLS; 587 upgrades with STARTTLS after connecting.
      secure: bool(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT ?? 587) === 465),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASSWORD ?? '',
      from: process.env.MAIL_FROM ?? 'Phone ERP <no-reply@localhost>',
      sweepMs: Number(process.env.MAIL_SWEEP_MS ?? 60_000),
      maxAttempts: Number(process.env.MAIL_MAX_ATTEMPTS ?? 6),
    },
    throttle: {
      ttlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
      limit: Number(process.env.THROTTLE_LIMIT ?? 300),
      // Low on purpose: login is the one endpoint worth brute-forcing.
      loginLimit: Number(process.env.THROTTLE_LOGIN_LIMIT ?? 10),
    },
  };
}

/** Fails fast at boot rather than at the first request. */
export function validateConfiguration(config: AppConfig): void {
  const errors: string[] = [];
  if (!config.databaseUrl) errors.push('DATABASE_URL is required');
  if (!config.jwt.secret) errors.push('JWT_SECRET is required');
  if (config.jwt.secret && config.jwt.secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }
  if (config.nodeEnv === 'production' && config.cors.origins.length === 0) {
    errors.push('CORS_ORIGIN (or FRONTEND_URL) is required in production');
  }
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
}
