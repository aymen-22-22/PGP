import { ConsoleLogger, type LogLevel as NestLevel } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { describeError, writeLog, type LogLevel } from './file-log';

/** Start-up chatter that fills the file on every restart and never explains a problem. */
const QUIET_CONTEXTS = new Set(['RouterExplorer', 'RoutesResolver', 'InstanceLoader', 'NestFactory', 'NestApplication']);

/** Nest's own logger, also copying every line to the daily file. */
export class FileLogger extends ConsoleLogger {
  private write(level: LogLevel, message: unknown, context?: string, detail?: unknown) {
    const ctx = context ?? this.context ?? 'App';
    if (level === 'info' && QUIET_CONTEXTS.has(ctx)) return;
    // "Not signed in" is what every visit before login looks like — not a problem.
    if (level === 'warn' && typeof message === 'string' && message.endsWith('401 UNAUTHENTICATED')) return;
    writeLog(level, context ?? this.context ?? 'App', typeof message === 'string' ? message : JSON.stringify(message), detail);
  }

  override log(message: unknown, context?: string) {
    super.log(message, context);
    this.write('info', message, context);
  }

  override warn(message: unknown, context?: string) {
    super.warn(message, context);
    this.write('warn', message, context);
  }

  override error(message: unknown, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.write('error', message, context, stack);
  }

  override debug(message: unknown, context?: string) {
    super.debug(message, context);
    if (process.env.LOG_DEBUG === 'true') this.write('debug', message, context);
  }

  static levels(production: boolean): NestLevel[] {
    return production ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug'];
  }
}

const mb = (bytes: number) => Math.round(bytes / 1_048_576);

/** Threads in this process (Linux) — the number a shared host's cap is counted against. */
function threads(): number | null {
  try {
    const m = /Threads:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

const stats = { requests: 0, errors: 0, slow: 0 };
const SLOW_MS = Number(process.env.LOG_SLOW_MS || 3000);

/**
 * Counts requests for the heartbeat and writes down the slow ones and the
 * failures — the requests that explain "it was slow" and "it broke" later.
 */
export function requestMonitor(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    stats.requests += 1;
    const line = `${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Math.round(ms)} ms`;
    if (res.statusCode >= 500) {
      stats.errors += 1;
      writeLog('error', 'Request', line, { ip: req.ip });
    } else if (ms >= SLOW_MS) {
      stats.slow += 1;
      writeLog('warn', 'Slow', line);
    }
  });
  next();
}

let installed = false;

/**
 * Records the life of the process: start, a heartbeat every few minutes, and
 * how it ended — signal, crash or clean exit. When the site "fails and comes
 * back", these lines say which of those it was and what memory looked like
 * just before.
 */
export function installProcessMonitor(): void {
  if (installed) return;
  installed = true;

  writeLog('info', 'Process', `Starting (Node ${process.version}, pid ${process.pid})`, {
    node: process.version,
    env: process.env.NODE_ENV,
    build: process.env.BUILD_SHA ?? null,
    memoryMb: mb(process.memoryUsage().rss),
    threads: threads(),
    tokioWorkers: process.env.TOKIO_WORKER_THREADS ?? null,
  });

  process.on('uncaughtException', (error) => {
    const { msg, stack } = describeError(error);
    writeLog('fatal', 'Crash', `Uncaught exception: ${msg}`, stack);
    // State is unknown after this; Passenger starts a fresh process on the next request.
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const { msg, stack } = describeError(reason);
    writeLog('error', 'Crash', `Unhandled promise rejection: ${msg}`, stack);
  });

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.once(signal, () => {
      writeLog('warn', 'Process', `Received ${signal} — the host is stopping the app`, {
        uptimeMin: Math.round(process.uptime() / 60),
        memoryMb: mb(process.memoryUsage().rss),
      });
      // Let Nest's own shutdown hooks run, then make sure the process ends.
      setTimeout(() => process.exit(0), 5_000).unref();
    });
  }

  process.on('exit', (code) => {
    writeLog(code === 0 ? 'info' : 'error', 'Process', `Exited with code ${code}`, {
      uptimeMin: Math.round(process.uptime() / 60),
      memoryMb: mb(process.memoryUsage().rss),
    });
  });

  process.on('warning', (warning) => {
    writeLog('warn', 'Node', `${warning.name}: ${warning.message}`, warning.stack);
  });

  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();

  const everyMs = Number(process.env.LOG_HEARTBEAT_MS || 5 * 60_000);
  const warnAtMb = Number(process.env.LOG_MEMORY_WARN_MB || 400);
  setInterval(() => {
    const mem = process.memoryUsage();
    const rss = mb(mem.rss);
    const lagMs = Math.round(loop.max / 1e6);
    writeLog(rss >= warnAtMb || lagMs > 1000 ? 'warn' : 'info', 'Heartbeat', `OK — ${rss} MB, ${stats.requests} requests, ${stats.errors} errors`, {
      uptimeMin: Math.round(process.uptime() / 60),
      rssMb: rss,
      heapMb: mb(mem.heapUsed),
      threads: threads(),
      eventLoopMaxMs: lagMs,
      requests: stats.requests,
      errors: stats.errors,
      slow: stats.slow,
    });
    stats.requests = 0;
    stats.errors = 0;
    stats.slow = 0;
    loop.reset();
  }, everyMs).unref();
}
