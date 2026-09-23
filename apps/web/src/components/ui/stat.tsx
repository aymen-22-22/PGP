import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n/provider';
import { cn, formatNumber } from '@/lib/utils';

/**
 * The headline figure tile. Large numerals on purpose: these are read across a
 * warehouse floor, often one-handed.
 */
export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  icon: Icon,
  onClick,
  to,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'muted';
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  /** Turns the whole tile into a link to the records behind the figure. */
  to?: string;
  className?: string;
}) {
  // Tone colours the icon chip only; the figure stays in text ink so it reads
  // the same on every tile and never relies on colour alone.
  const chipClass = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-muted text-muted-foreground',
  }[tone];

  const t = useT();
  const interactive = Boolean(to || onClick);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        {Icon ? (
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', chipClass)}>
            <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
          </span>
        ) : (
          <span className={cn('h-9 w-1.5 rounded-full', chipClass)} aria-hidden />
        )}
        {/* The arrow says the figure can be opened. Without it a tile that
            happens to be clickable looks exactly like one that is not. */}
        {to && (
          <ArrowUpRight
            className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden
          />
        )}
      </div>
      <span className="mt-2 text-[0.8rem] font-medium text-muted-foreground">{label}</span>
      <span className="tabular text-stat text-foreground">
        {typeof value === 'number' ? formatNumber(value) : value}
      </span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </>
  );

  const shell = cn(
    'flex w-full flex-col gap-0.5 rounded-xl border bg-card p-4 text-start text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.05)] sm:p-5',
    interactive &&
      cn(
        'group cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
        // A visible focus ring is the whole of keyboard usability here: without
        // it, tabbing through the dashboard gives no sign of where you are.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      ),
    className,
  );

  if (to) {
    return (
      <Link to={to} className={shell} aria-label={t('home.openFigure', { label: String(label) })}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shell}>
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>;
}
