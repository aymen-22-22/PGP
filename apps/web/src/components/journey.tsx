import { Check, Truck, X } from 'lucide-react';
import * as React from 'react';
import { countryFromWarehouseCode, flagOf } from '@/lib/countries';
import { cn } from '@/lib/utils';

export interface Place {
  name: string;
  code?: string | null;
}

/**
 * Where the goods are between two places, drawn rather than written: flag and
 * name at each end, and a truck that sits at the start, on the road, or at the
 * destination.
 */
export function RouteLine({
  from,
  to,
  progress,
  cancelled = false,
  className,
}: {
  from: Place;
  to: Place;
  /** 0 = not left yet, 0.5 = on the road, 1 = arrived. */
  progress: number;
  cancelled?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <PlaceTag place={from} />
      <div className="relative h-10 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full border-t-2 border-dashed border-muted-foreground/30" />
        <div
          className={cn(
            'absolute start-0 top-1/2 h-1 -translate-y-1/2 rounded-full transition-[width] duration-700',
            cancelled ? 'bg-destructive/60' : 'bg-orange-500',
          )}
          style={{ width: `${pct}%` }}
        />
        <span
          className={cn(
            'absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-card shadow-sm',
            cancelled ? 'border-destructive text-destructive' : pct >= 100 ? 'border-success text-success' : 'border-orange-500 text-orange-600',
          )}
          style={{ insetInlineStart: `calc((100% - 2.25rem) * ${pct / 100})` }}
          aria-hidden
        >
          {cancelled ? <X className="h-4 w-4" /> : pct >= 100 ? <Check className="h-4 w-4" /> : <Truck className="h-4 w-4 rtl:-scale-x-100" />}
        </span>
      </div>
      <PlaceTag place={to} align="end" />
    </div>
  );
}

function PlaceTag({ place, align = 'start' }: { place: Place; align?: 'start' | 'end' }) {
  return (
    <div className={cn('flex min-w-0 max-w-[40%] flex-col', align === 'end' ? 'items-end text-end' : 'items-start')}>
      <span className="text-2xl leading-none" aria-hidden>
        {flagOf(countryFromWarehouseCode(place.code))}
      </span>
      <span className="mt-1 truncate text-sm font-semibold">{place.name}</span>
    </div>
  );
}

export interface Step {
  label: string;
  /** When and by whom, or how many — one short line. */
  detail?: React.ReactNode;
  state: 'done' | 'current' | 'todo' | 'failed';
  icon?: React.ComponentType<{ className?: string }>;
}

/** A row of milestones on a wide screen, a column on a phone. */
export function Steps({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-0 sm:flex-row', className)}>
      {steps.map((step, i) => {
        const Icon = step.icon;
        const last = i === steps.length - 1;
        return (
          <li key={step.label} className="relative flex gap-3 pb-5 sm:flex-1 sm:flex-col sm:items-center sm:pb-0 sm:text-center">
            {!last && (
              <span
                aria-hidden
                className={cn(
                  'absolute start-[15px] top-8 h-[calc(100%-2rem)] w-0.5 sm:start-[calc(50%+1.25rem)] sm:top-[15px] sm:h-0.5 sm:w-[calc(100%-2.5rem)]',
                  step.state === 'done' ? 'bg-success' : 'bg-border',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                step.state === 'done' && 'border-success bg-success text-white',
                step.state === 'current' && 'border-primary bg-primary/10 text-primary ring-4 ring-primary/15',
                step.state === 'todo' && 'border-border bg-card text-muted-foreground',
                step.state === 'failed' && 'border-destructive bg-destructive text-white',
              )}
            >
              {step.state === 'done' ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : step.state === 'failed' ? (
                <X className="h-4 w-4" strokeWidth={3} />
              ) : Icon ? (
                <Icon className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0 sm:mt-2 sm:px-1">
              <p className={cn('text-sm font-semibold', step.state === 'todo' && 'text-muted-foreground')}>{step.label}</p>
              {step.detail && <p className="text-xs text-muted-foreground">{step.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
