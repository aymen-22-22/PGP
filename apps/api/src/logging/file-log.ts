import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Daily log files the host cannot take away.
 *
 * On shared hosting the application's stdout goes wherever Passenger decides,
 * often nowhere an owner can reach — and when the app dies at start-up there
 * is nothing on screen but "could not be started". So everything worth knowing
 * about the process's life is also appended to logs/app-YYYY-MM-DD.log, one
 * JSON object per line, readable over SSH (`tail -f`) and from the admin Logs
 * page.
 *
 * Writes are synchronous on purpose: the lines that matter most are the last
 * ones before a crash, and a buffered stream loses exactly those.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  t: string;
  level: LogLevel;
  ctx: string;
  msg: string;
  pid: number;
  /** Stack trace or any extra structured detail. */
  detail?: unknown;
}

export const LOG_DIR = resolve(process.env.LOG_DIR || './logs');
const KEEP_DAYS = Number(process.env.LOG_KEEP_DAYS || 14);
const FILE = /^app-(\d{4}-\d{2}-\d{2})\.log$/;

let ready = false;
let lastPrunedDay = '';

export const dayOf = (date = new Date()): string => date.toISOString().slice(0, 10);
export const fileFor = (day: string): string => join(LOG_DIR, `app-${day}.log`);

function ensureDir(): boolean {
  if (ready) return true;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    ready = true;
  } catch {
    ready = false;
  }
  return ready;
}

function prune(today: string): void {
  if (lastPrunedDay === today) return;
  lastPrunedDay = today;
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  try {
    for (const name of readdirSync(LOG_DIR)) {
      const m = FILE.exec(name);
      if (m && Date.parse(m[1]!) < cutoff) unlinkSync(join(LOG_DIR, name));
    }
  } catch {
    /* pruning is housekeeping; never let it break logging */
  }
}

/** Keeps a log line to a sane size, so one huge payload cannot fill the disk. */
function clip(value: string, max = 8_000): string {
  return value.length > max ? `${value.slice(0, max)}… [${value.length - max} more chars]` : value;
}

export function writeLog(level: LogLevel, ctx: string, msg: string, detail?: unknown): void {
  if (!ensureDir()) return;
  const now = new Date();
  const day = dayOf(now);
  prune(day);
  const entry: LogEntry = { t: now.toISOString(), level, ctx, msg: clip(msg), pid: process.pid };
  if (detail !== undefined && detail !== null && detail !== '') {
    entry.detail = typeof detail === 'string' ? clip(detail) : detail;
  }
  try {
    appendFileSync(fileFor(day), `${JSON.stringify(entry)}\n`);
  } catch {
    /* a full disk must not take the application down with it */
  }
}

export function listLogFiles(): { day: string; bytes: number }[] {
  if (!ensureDir()) return [];
  return readdirSync(LOG_DIR)
    .map((name) => FILE.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ day: m[1]!, bytes: statSync(join(LOG_DIR, m[0])).size }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export const isLogDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Turns an unknown thrown value into something worth writing down. */
export function describeError(error: unknown): { msg: string; stack?: string } {
  if (error instanceof Error) return { msg: `${error.name}: ${error.message}`, stack: error.stack };
  return { msg: String(error) };
}
