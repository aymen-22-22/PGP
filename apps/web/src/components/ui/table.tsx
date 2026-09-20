import * as React from 'react';
import { cn } from '@/lib/utils';

/** Tables scroll inside their own container so the page never scrolls sideways. */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto rounded-lg border bg-card', className)}>
      <table className="w-full caption-bottom text-sm">{children}</table>
    </div>
  );
}

export const Th = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      'whitespace-nowrap border-b px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground',
      className,
    )}
    {...props}
  />
);

export const Td = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('whitespace-nowrap border-b px-3 py-3 align-middle', className)} {...props} />
);

export const Tr = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('transition-colors hover:bg-accent/40', className)} {...props} />
);
