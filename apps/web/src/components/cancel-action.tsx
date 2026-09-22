import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/provider';

/**
 * "Cancel this purchase/sale/transfer" — a document-level status change, not
 * a form dismissal, so it gets its own inline are-you-sure rather than
 * riding common.cancel's wording.
 */
export function CancelAction({
  path,
  confirmLabel,
  invalidatePrefixes,
  onDone,
}: {
  path: string;
  confirmLabel: string;
  invalidatePrefixes: string[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const cancel = useApiMutation(() => api.post(path, {}), invalidatePrefixes);

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
        <p className="flex-1 text-sm">{confirmLabel}</p>
        <Button
          variant="destructive"
          size="sm"
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate(undefined, {
              onSuccess: () => {
                setConfirming(false);
                onDone();
              },
              onError: (error) => toast.push('error', error.message),
            })
          }
        >
          {t('common.confirm')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {t('common.back')}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
      {t('common.cancelDocument')}
    </Button>
  );
}
