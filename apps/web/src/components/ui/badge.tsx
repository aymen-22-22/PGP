import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { useStatusLabel } from '@/lib/status';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Every status in the system maps to exactly one colour, so a warehouse user
 * learns the palette once: green is good, amber is in-flight, red is a problem.
 */
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  IN_STOCK: 'success',
  RECEIVED: 'warning',
  IN_TRANSFER: 'warning',
  IN_TRANSIT: 'warning',
  EXPECTED: 'secondary',
  SOLD: 'default',
  RETURNED: 'secondary',
  DAMAGED: 'destructive',
  LOST: 'destructive',
  DRAFT: 'secondary',
  ORDERED: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  CANCELLED: 'destructive',
  READY: 'warning',
  PREPARING: 'secondary',
  DELIVERED: 'warning',
  CONFIRMED: 'warning',
  COMPLETED: 'success',
  VALIDATED: 'success',
  PENDING_VALIDATION: 'warning',
  RESTOCKED: 'success',
  INSPECTION: 'warning',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = useStatusLabel()(status);
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'} className={className} title={status}>
      {label}
    </Badge>
  );
}

export { badgeVariants };
