import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * On a phone each row becomes a small card: the first cell is its title and
 * every other cell is shown under the column name it belongs to. The labels are
 * copied from the header here, so no page has to repeat them on every cell.
 */
export function TableWrap({
  children,
  className,
  stack = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Keep a real scrolling table on phones too — for grids read across, not down. */
  stack?: boolean;
}) {
  const ref = React.useRef<HTMLTableElement>(null);

  React.useLayoutEffect(() => {
    const table = ref.current;
    if (!table || !stack) return;
    const label = () => {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
      for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
        let col = 0;
        for (const cell of row.children) {
          const text = heads[col] ?? '';
          if (cell.getAttribute('data-label') !== text) cell.setAttribute('data-label', text);
          col += (cell as HTMLTableCellElement).colSpan || 1;
        }
      }
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stack]);

  return (
    <div className={cn('w-full overflow-x-auto rounded-lg border bg-card', stack && 'stack-table', className)}>
      <table ref={ref} className="w-full caption-bottom text-sm">
        {children}
      </table>
    </div>
  );
}

export const Th = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      'whitespace-nowrap border-b bg-muted/70 px-3 py-2 text-start text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground',
      className,
    )}
    {...props}
  />
);

export const Td = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('whitespace-nowrap border-b px-3 py-2.5 align-middle', className)} {...props} />
);

export const Tr = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('transition-colors hover:bg-accent/50 [&:last-child>td]:border-b-0', className)} {...props} />
);
