import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { useI18n } from '@/i18n/provider';
import { isAdmin, useAuth } from '@/lib/auth';

export interface Option {
  id: string;
  name: string;
}

/**
 * A dropdown that can also create what is missing.
 *
 * The alternative is abandoning a half-filled form to go and add a customer
 * on another screen, which is how orders get typed twice. The `+` only
 * appears for someone allowed to create the thing — a picker selects a
 * carrier, they do not invent one — and the API refuses it regardless.
 */
export function SelectOrCreate({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
  disabled,
  canCreate,
  createLabel,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: Option[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Defaults to admin-only, which is what every current caller wants. */
  canCreate?: boolean;
  createLabel: string;
  /** The creation form, given a callback to run once the thing exists. */
  children?: (done: (created: Option) => void) => ReactNode;
}) {
  const { t } = useI18n();
  const admin = isAdmin(useAuth((s) => s.user));
  const allowed = (canCreate ?? admin) && Boolean(children);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
      >
        <option value="">{placeholder ?? t('common.choose')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>

      {allowed && !creating && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ms-2 gap-1"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4" />
          {createLabel}
        </Button>
      )}

      {/* Whatever was just created is selected straight away — the reason
          anyone opened this instead of leaving the form. */}
      {allowed && creating && (
        <div className="rounded-md border bg-muted/30 p-3">
          {children!((created) => {
            onChange(created.id);
            setCreating(false);
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setCreating(false)}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
