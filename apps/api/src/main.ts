import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfiguration, validateConfiguration } from './config/configuration';
import { describeError, writeLog } from './logging/file-log';
import { FileLogger, installProcessMonitor, requestMonitor } from './logging/process-monitor';
import { PrismaService } from './prisma/prisma.service';

/**
 * Keep the thread count small enough for shared hosting.
 *
 * Prisma's query engine starts one worker thread per CPU core of the machine
 * — dozens on a shared host — and the account's thread cap stops it partway,
 * which it reports as "PANIC: timer has gone away" and the host as "could not
 * be started". Two workers are plenty for this application. Set before the
 * engine loads; an explicit value in the environment still wins.
 */
process.env.TOKIO_WORKER_THREADS ??= '2';
process.env.UV_THREADPOOL_SIZE ??= '2';

async function bootstrap(): Promise<void> {
  installProcessMonitor();
  const config = loadConfiguration();
  validateConfiguration(config);

  const logger = new FileLogger();
  logger.setLogLevels(FileLogger.levels(config.nodeEnv === 'production'));
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.use(requestMonitor);

  // Behind a shared-hosting reverse proxy, req.ip must come from X-Forwarded-For
  // or rate limiting and audit logs would record the proxy for every user.
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(cookieParser());

  // Product photos, written by the upload endpoint.
  //
  // Served before the web app so a real file always wins over the single-page
  // fallback, and read-only: nothing here is ever executed, and the directory
  // holds only what the upload endpoint chose to name.
  const uploadDir = resolve(config.uploads.dir);
  mkdirSync(join(uploadDir, 'products'), { recursive: true });
  const serveUploads = express.static(uploadDir, {
    index: false,
    dotfiles: 'deny',
    // Names carry a random id, so a given URL never changes content.
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
  });
  // /api/uploads is the address photos get now: it reaches the application
  // even where the host routes only /api to it. /uploads stays for any link
  // saved before the move.
  app.use('/api/uploads', serveUploads);
  app.use('/uploads', serveUploads);

  // Optionally serve the built web app from the API itself.
  //
  // One origin is the simplest safe deployment: no CORS, and the session cookie
  // is same-site by construction rather than by configuration. Set
  // SERVE_WEB_ROOT to the web build directory to turn this on.
  if (config.webRoot) {
    const webRoot = resolve(config.webRoot);
    const indexHtml = join(webRoot, 'index.html');

    if (!existsSync(indexHtml)) {
      throw new Error(
        `SERVE_WEB_ROOT is set to ${webRoot} but there is no index.html there. ` +
          'Build the web app first: npm run build -w @phone-erp/web',
      );
    }

    const files = express.static(webRoot, {
      index: false,
      setHeaders: (res, filePath) => {
        // Asset names carry a content hash, so they can be cached forever. The
        // shell and the service worker must always be revalidated or a deploy
        // never reaches anyone who already has the app open.
        const name = filePath.split('/').pop() ?? '';
        const immutable = /\.(js|css|woff2?|png|svg|jpg|webp)$/.test(name) && filePath.includes('/assets/');
        res.setHeader(
          'Cache-Control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) return next();

      files(req, res, () => {
        // A missing hashed asset must 404, never fall back to the shell —
        // answering a JavaScript request with HTML produces an unreadable MIME
        // error instead of a clean miss the app can recover from.
        if (req.path.startsWith('/assets/')) {
          res.status(404).type('text/plain').send('Not found');
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        // Single-page app: any other path is a client route.
        res.sendFile(indexHtml);
      });
    });
  }
  app.use(
    helmet({
      // The API serves JSON only; CSP belongs to whatever serves the frontend.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.setGlobalPrefix(config.apiPrefix);
  app.enableCors({
    origin: config.cors.origins.length > 0 ? config.cors.origins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Phone Distribution ERP API')
        .setDescription(
          'B2B phone distribution with IMEI-level traceability. ' +
            'Browser clients authenticate with an HTTP-only cookie and echo the CSRF cookie in X-CSRF-Token; ' +
            'API clients may send a Bearer token instead.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth(config.cookie.name)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const prisma = app.get(PrismaService);
  prisma.enableShutdownHooks(app);
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  const boot = new Logger('Bootstrap');
  boot.log(`API listening on ${config.host}:${config.port} (${config.nodeEnv})`);
  boot.log(`Base path: /${config.apiPrefix}`);
  if (config.webRoot) boot.log(`Serving the web app from ${resolve(config.webRoot)}`);
  if (config.swaggerEnabled) boot.log('Swagger UI: /api/docs');
  boot.log(
    `Receipt validation: ${config.receiving.requireValidation ? 'required' : 'automatic'}; ` +
      `partial receipts ${config.receiving.allowPartial ? 'allowed' : 'blocked'}`,
  );
}

// A start-up failure (bad config, database unreachable) is exactly the case the
// host reports only as "could not be started" — so it is written down first.
bootstrap().catch((error: unknown) => {
  const { msg, stack } = describeError(error);
  const hint = /timer has gone away|Resource temporarily unavailable|EAGAIN/i.test(msg)
    ? ' — the host refused more threads/processes: stop leftover processes (ps -u $USER) and lower TOKIO_WORKER_THREADS'
    : '';
  writeLog('fatal', 'Bootstrap', `Could not start: ${msg}${hint}`, stack);
  console.error(error);
  process.exit(1);
});
