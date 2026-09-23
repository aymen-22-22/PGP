import { Activity, AlertOctagon, AlertTriangle, BellRing, Download, HeartPulse, Info, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, SearchField } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface Entry {
  t: string;
  level: Level;
  ctx: string;
  msg: string;
  pid: number;
  detail?: unknown;
}

interface Health {
  pid: number;
  node: string;
  uptimeSeconds: number;
  memoryMb: number;
  heapMb: number;
  today: { starts: number; stops: number; crashes: number; errors: number; warnings: number; lastProblem: Entry | null };
}

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

const LEVEL_STYLE: Record<Level, { icon: typeof Info; row: string; chip: string }> = {
  debug: { icon: Info, row: '', chip: 'bg-slate-100 text-slate-600' },
  info: { icon: Info, row: '', chip: 'bg-blue-50 text-blue-700' },
  warn: { icon: AlertTriangle, row: 'bg-amber-50/60', chip: 'bg-amber-100 text-amber-800' },
  error: { icon: AlertOctagon, row: 'bg-red-50/70', chip: 'bg-red-100 text-red-700' },
  fatal: { icon: AlertOctagon, row: 'bg-red-100/80', chip: 'bg-red-600 text-white' },
};

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * What the server has been doing: starts, stops, crashes, errors, slow
 * requests and a heartbeat every few minutes — read here instead of over SSH.
 */
export default function SystemLogsPage() {
  const { t, dateTime } = useI18n();
  const [day, setDay] = useState('');
  const [level, setLevel] = useState<'info' | 'warn' | 'error'>('warn');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const q = useDebounce(search);

  const health = useApiQuery<Health>('/system/health', { refetchInterval: 30_000 });
  const files = useApiQuery<{ day: string; bytes: number }[]>('/system/logs/files');
  const selected = day || files.data?.[0]?.day || '';
  const params = new URLSearchParams({ level, limit: '1000', ...(selected ? { day: selected } : {}), ...(q ? { q } : {}) });
  const logs = useApiQuery<{ total: number; data: Entry[] }>(`/system/logs?${params.toString()}`, {
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('logs.title')}
        description={t('logs.lead')}
        action={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => void Promise.all([health.refetch(), logs.refetch(), files.refetch()])}>
              <RefreshCw className="h-4 w-4" />
              {t('logs.refresh')}
            </Button>
            {selected && (
              <Button asChild variant="outline" className="gap-2">
                <a href={`${BASE}/system/logs/download?day=${selected}`}>
                  <Download className="h-4 w-4" />
                  {t('logs.download')}
                </a>
              </Button>
            )}
          </div>
        }
      />

      {health.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HealthTile
            icon={HeartPulse}
            tone="good"
            label={t('logs.running')}
            value={uptime(health.data.uptimeSeconds)}
            sub={t('logs.memory', { mb: health.data.memoryMb })}
          />
          <HealthTile
            icon={RotateCcw}
            tone={health.data.today.starts > 2 ? 'warn' : 'good'}
            label={t('logs.restartsToday')}
            value={String(Math.max(0, health.data.today.starts))}
            sub={t('logs.stopsToday', { count: health.data.today.stops })}
          />
          <HealthTile
            icon={AlertOctagon}
            tone={health.data.today.crashes > 0 ? 'bad' : 'good'}
            label={t('logs.crashesToday')}
            value={String(health.data.today.crashes)}
          />
          <HealthTile
            icon={Activity}
            tone={health.data.today.errors > 0 ? 'warn' : 'good'}
            label={t('logs.errorsToday')}
            value={String(health.data.today.errors)}
            sub={t('logs.warningsToday', { count: health.data.today.warnings })}
          />
        </div>
      )}

      <ErrorAlerts />

      {health.data?.today.lastProblem && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-semibold text-red-800">{t('logs.lastProblem')}</p>
          <p className="text-red-900">
            {dateTime(health.data.today.lastProblem.t)} · [{health.data.today.lastProblem.ctx}]{' '}
            {health.data.today.lastProblem.msg}
          </p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[14rem_13rem_1fr]">
        <Select value={selected} onChange={(e) => setDay(e.target.value)} aria-label={t('logs.day')}>
          {(files.data ?? []).map((f) => (
            <option key={f.day} value={f.day}>
              {f.day} · {Math.max(1, Math.round(f.bytes / 1024))} KB
            </option>
          ))}
        </Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label={t('logs.level')}>
          <option value="error">{t('logs.onlyErrors')}</option>
          <option value="warn">{t('logs.warningsAndErrors')}</option>
          <option value="info">{t('logs.everything')}</option>
        </Select>
        <SearchField value={search} onChange={setSearch} placeholder={t('logs.search')} />
      </div>

      {logs.isLoading && <LoadingState />}
      {logs.isError && <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />}
      {logs.data && logs.data.data.length === 0 && (
        <EmptyState icon={HeartPulse} title={t('logs.nothing')} description={t('logs.nothingBody')} />
      )}

      {logs.data && logs.data.data.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card font-mono text-xs">
          {logs.data.data.map((entry, i) => {
            const style = LEVEL_STYLE[entry.level] ?? LEVEL_STYLE.info;
            const hasDetail = entry.detail !== undefined;
            return (
              <li key={`${entry.t}-${i}`} className={style.row}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-start"
                  onClick={() => hasDetail && setOpen(open === i ? null : i)}
                >
                  <span className="shrink-0 text-muted-foreground">{entry.t.slice(11, 19)}</span>
                  <span className={cn('shrink-0 rounded px-1.5 font-sans text-[0.65rem] font-bold uppercase', style.chip)}>
                    {entry.level}
                  </span>
                  <span className="shrink-0 font-semibold">{entry.ctx}</span>
                  <span className="min-w-0 flex-1 break-words">{entry.msg}</span>
                  {hasDetail && <span className="shrink-0 text-muted-foreground">{open === i ? '▾' : '▸'}</span>}
                </button>
                {open === i && hasDetail && (
                  <pre className="overflow-x-auto whitespace-pre-wrap border-t bg-background/60 px-3 py-2 text-[0.7rem]">
                    {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {logs.data && logs.data.total > logs.data.data.length && (
        <p className="text-xs text-muted-foreground">{t('logs.more', { shown: logs.data.data.length, total: logs.data.total })}</p>
      )}
    </div>
  );
}

interface Alerts {
  enabled: boolean;
  recipients: string[];
  lastSentAt: string | null;
}

/** Who gets an email when the server logs an error or crashes. */
function ErrorAlerts() {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const query = useApiQuery<Alerts>('/system/alerts');
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.enabled);
    setText(query.data.recipients.join(', '));
  }, [query.data]);

  const recipients = text.split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean);
  const save = useApiMutation(() => api.put<Alerts>('/system/alerts', { enabled, recipients }), ['/system/alerts']);
  const test = useApiMutation(() => api.post('/system/alerts/test', { recipients }), []);

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellRing className="h-4 w-4 text-primary" />
          {t('alerts.title')}
        </h2>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('alerts.enabled')}
        </label>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('alerts.lead')}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="admin@example.com, it@example.com"
          aria-label={t('alerts.recipients')}
        />
        <Button
          disabled={save.isPending || (enabled && recipients.length === 0)}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => toast.push('success', t('alerts.saved')),
              onError: (error) => toast.push('error', error.message),
            })
          }
        >
          {save.isPending ? t('common.saving') : t('alerts.save')}
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          disabled={test.isPending || recipients.length === 0}
          onClick={() =>
            test.mutate(undefined, {
              onSuccess: () => toast.push('success', t('alerts.testSent')),
              onError: (error) => toast.push('error', error.message),
            })
          }
        >
          <Send className="h-4 w-4" />
          {t('alerts.test')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {query.data?.lastSentAt ? t('alerts.lastSent', { when: dateTime(query.data.lastSentAt) }) : t('alerts.never')}{' '}
        · <Link to="/settings/email" className="font-medium text-primary hover:underline">{t('alerts.mailServer')}</Link>
      </p>
    </section>
  );
}

function HealthTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Info;
  label: string;
  value: string;
  sub?: string;
  tone: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg',
          tone === 'good' ? 'bg-success/10 text-success' : tone === 'warn' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive',
        )}
      >
        <Icon className="h-[1.1rem] w-[1.1rem]" />
      </span>
      <p className="mt-2 text-[0.8rem] font-medium text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
