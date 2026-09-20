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
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    muted: 'text-muted-foreground',
  }[tone];

  const t = useT();
  const interactive = Boolean(to || onClick);

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {/* The arrow says the figure can be opened. Without it a tile that
            happens to be clickable looks exactly like one that is not. */}
        {to ? (
          <ArrowUpRight
            className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
            aria-hidden
          />
        ) : (
          Icon && <Icon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <span className={cn('tabular text-stat', toneClass)}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </>
  );

  const shell = cn(
    'flex w-full flex-col gap-1 rounded-lg border bg-card p-4 text-start text-card-foreground shadow-sm sm:p-5',
    interactive &&
      cn(
        'group cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40',
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
