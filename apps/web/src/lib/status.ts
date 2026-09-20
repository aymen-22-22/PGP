import { useI18n } from '@/i18n/provider';

/**
 * The human-readable label of a status in the current language.
 *
 * Statuses arrive as stable codes (`PENDING_VALIDATION`); the dictionary holds
 * their translations under `status.*`. A status that once existed but has since
 * been retired from the dictionary falls back to its readable code rather than
 * leaking a `status.PENDING_VALIDATION` key onto the screen.
 */
export function useStatusLabel(): (status: string) => string {
  const { t } = useI18n();
  return (status: string) => {
    const key = `status.${status}`;
    const label = t(key);
    return label === key ? status.replace(/_/g, ' ') : label;
  };
}