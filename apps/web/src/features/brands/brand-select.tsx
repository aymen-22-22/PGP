import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { BrandSummary, Listed } from '@phone-erp/shared-types';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';


/**
 * Pick a make, or add one without leaving the form.
 *
 * A product cannot be saved without a brand, so sending someone to another page
 * to create one would mean abandoning what they had typed. The new make is
 * selected the moment it exists.
 */
export function BrandSelect({
  value,
  onChange,
  canCreate,
  label,
}: {
  value: string;
  onChange: (brandId: string) => void;
  /** Only administrators may add to the catalogue. */
  canCreate: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const brands = useApiQuery<Listed<BrandSummary>>('/brands');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const resolvedLabel = label ?? t('brands.brand');

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const brand = await api.post<BrandSummary>('/brands', { name: trimmed });
      await brands.refetch();
      onChange(brand.id);
      setAdding(false);
      setName('');
      toast.push('success', t('brands.added', { name: brand.name }));
    } catch (error) {
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="brand-new">{t('brands.new')}</Label>
        <div className="flex gap-2">
          <Input
            id="brand-new"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('brands.placeholder')}
            autoFocus
            // Enter would otherwise submit the product form behind this.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Button type="button" onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? t('brands.adding') : t('brands.add')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('brands.keepToMakes')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="brand">{resolvedLabel}</Label>
      <div className="flex gap-2">
        <Select
          id="brand"
          className="flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        >
          <option value="">{t('brands.choose')}</option>
          {brands.data?.data.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </Select>

        {canCreate && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12 shrink-0"
            aria-label={t('brands.createAria')}
            title={t('brands.createAria')}
            onClick={() => setAdding(true)}
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
