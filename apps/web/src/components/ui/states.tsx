import { AlertTriangle, Inbox, Loader2, Lock, SearchX, WifiOff } from 'lucide-react';
import * as React from 'react';
import { useT } from '@/i18n/provider';
import { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** The six states every screen must be able to show (spec §49). */

export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  const shown = label ?? t('common.loading');
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground', className)}>
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      <p className="text-sm">{shown}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const apiError = error instanceof ApiRequestError ? error : null;

  if (apiError?.isUnreachable) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
        <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="font-semibold">{t('state.error.unreachable')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Check your connection and try again — nothing you have saved is lost.
        </p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    );
  }

  // A missing record and a rejected input are not system failures, and offering
  // "try again" for either just invites the user to repeat a request that
  // cannot succeed.
  if (apiError?.status === 404) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
        <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="font-semibold">{t('state.error.notFound')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {apiError.message || 'This record no longer exists, or the link is wrong.'}
        </p>
      </div>
    );
  }

  if (apiError && apiError.status === 400) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
        <AlertTriangle className="h-10 w-10 text-warning" aria-hidden />
        <p className="font-semibold">{t('state.error.invalid')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{apiError.message}</p>
      </div>
    );
  }

  if (apiError?.isForbidden) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="font-semibold">{t('state.error.forbidden')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {apiError.message || 'This belongs to another warehouse.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <p className="font-semibold">{t('state.error.title')}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {apiError?.message ?? (error instanceof Error ? error.message : 'Unexpected error.')}
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiRequestError ? error.message : String(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
