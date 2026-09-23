import { BadRequestException, Controller, Get, Header, NotFoundException, Query, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'node:fs';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { dayOf, fileFor, isLogDay, listLogFiles, type LogEntry, type LogLevel } from '../logging/file-log';

/** Reading more than this from one day's file would stall the request; the newest part is what matters. */
const READ_TAIL_BYTES = 4 * 1_048_576;
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

function readEntries(day: string): LogEntry[] {
  const file = fileFor(day);
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const start = Math.max(0, size - READ_TAIL_BYTES);
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }
  const lines = buffer.toString('utf8').split('\n');
  if (start > 0) lines.shift(); // first line was cut in half
  const entries: LogEntry[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      entries.push({ t: '', level: 'info', ctx: 'raw', msg: line, pid: 0 });
    }
  }
  return entries;
}

@ApiTags('System')
@Controller('system')
@AdminOnly()
export class SystemController {
  @Get('health')
  @ApiOperation({ summary: 'How the running process is doing, and what today looked like' })
  health() {
    const today = readEntries(dayOf());
    const starts = today.filter((e) => e.ctx === 'Process' && e.msg.startsWith('Starting'));
    const stops = today.filter((e) => e.ctx === 'Process' && /Received SIG|Exited with code [^0]/.test(e.msg));
    const crashes = today.filter((e) => e.level === 'fatal');
    const mem = process.memoryUsage();
    return {
      now: new Date().toISOString(),
      pid: process.pid,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(mem.rss / 1_048_576),
      heapMb: Math.round(mem.heapUsed / 1_048_576),
      today: {
        starts: starts.length,
        stops: stops.length,
        crashes: crashes.length,
        errors: today.filter((e) => e.level === 'error').length,
        warnings: today.filter((e) => e.level === 'warn').length,
        lastProblem: [...today].reverse().find((e) => RANK[e.level] >= RANK.error) ?? null,
      },
    };
  }

  @Get('logs/files')
  @ApiOperation({ summary: 'Which days have a log file, newest first' })
  files() {
    return listLogFiles();
  }

  @Get('logs')
  @ApiOperation({ summary: 'One day of log entries, newest first, filtered' })
  logs(
    @Query('day') day?: string,
    @Query('level') level?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const which = day || dayOf();
    if (!isLogDay(which)) throw new BadRequestException('day must be YYYY-MM-DD');
    const min = level && level in RANK ? RANK[level as LogLevel] : 0;
    const needle = q?.trim().toLowerCase();
    const max = Math.min(Math.max(Number(limit) || 500, 1), 5_000);
    const matched = readEntries(which)
      .filter((e) => RANK[e.level] >= min)
      .filter(
        (e) =>
          !needle ||
          `${e.ctx} ${e.msg} ${typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail ?? '')}`
            .toLowerCase()
            .includes(needle),
      )
      .reverse();
    return { day: which, total: matched.length, data: matched.slice(0, max) };
  }

  @Get('logs/download')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'The raw file for one day' })
  download(@Query('day') day?: string): StreamableFile {
    const which = day || dayOf();
    if (!isLogDay(which)) throw new BadRequestException('day must be YYYY-MM-DD');
    const file = fileFor(which);
    if (!existsSync(file)) throw new NotFoundException('No log for that day');
    return new StreamableFile(createReadStream(file), {
      disposition: `attachment; filename="phone-erp-${which}.log"`,
    });
  }
}
