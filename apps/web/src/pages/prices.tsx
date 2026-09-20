import { Tag } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Country {
  id: string;
  code: string;
  name: string;
  currency: string;
}
interface PriceRow {
  productId: string;
  name: string;
  sku: string;
  price: string;
  currency: string;
  source: 'COUNTRY' | 'GLOBAL' | 'PRODUCT_DEFAULT';
}
interface HistoryRow {
  id: string;
  price: string;
  currency: string;
  validFrom: string;
  validTo: string | null;
  isCurrent: boolean;
  country: { code: string; name: string } | null;
  createdBy: { name: string } | null;
}

const SOURCE_KEY: Record<PriceRow['source'], string> = {
  COUNTRY: 'prices.source.country',
  GLOBAL: 'prices.source.global',
  PRODUCT_DEFAULT: 'prices.source.default',
};

/**
 * Selling prices are independent of what the goods cost and change often, so
 * this screen is built around the history rather than a single editable figure.
 */
export default function PricesPage() {
  const { t, money } = useI18n();
  const [countryId, setCountryId] = useState('');
  const [openProduct, setOpenProduct] = useState<PriceRow | null>(null);

  const countries = useApiQuery<Country[]>('/countries');
  const list = useApiQuery<PriceRow[]>(`/price-list${countryId ? `?countryId=${countryId}` : ''}`);

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.prices')} description={t('prices.lead')} />

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="price-country">{t('prices.market')}</Label>
        <Select id="price-country" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
          <option value="">{t('prices.allMarkets')}</option>
          {countries.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.currency}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading && <LoadingState />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.length === 0 && <EmptyState icon={Tag} title={t('prices.none')} />}

      {list.data && list.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('common.product')}</Th>
              <Th>{t('common.sku')}</Th>
              <Th className="text-end">{t('prices.sellsFor')}</Th>
              <Th>{t('prices.source')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((row) => (
              <Tr key={row.productId}>
                <Td className="max-w-[18rem] truncate font-medium">{row.name}</Td>
                <Td className="tabular text-muted-foreground">{row.sku}</Td>
                <Td className="tabular text-end text-base font-bold">
                  {money(row.price, row.currency)}
                </Td>
                <Td>
                  <Badge variant={row.source === 'PRODUCT_DEFAULT' ? 'secondary' : 'outline'}>
                    {t(SOURCE_KEY[row.source])}
                  </Badge>
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => setOpenProduct(row)}>
                    {t('prices.history')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {openProduct && (
        <PriceHistory
          product={openProduct}
          countryId={countryId}
          countries={countries.data ?? []}
          onClose={() => setOpenProduct(null)}
        />
      )}
    </div>
  );
}

function PriceHistory({
  product,
  countryId,
  countries,
  onClose,
}: {
  product: PriceRow;
  countryId: string;
  countries: Country[];
  onClose: () => void;
}) {
  const { t, money } = useI18n();
  const toast = useToast();
  const path = `/products/${product.productId}/prices${countryId ? `?countryId=${countryId}` : ''}`;
  const history = useApiQuery<HistoryRow[]>(path);

  const country = countries.find((c) => c.id === countryId);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(country?.currency ?? product.currency);
  const [validFrom, setValidFrom] = useState('');

  const setPriceMutation = useApiMutation(
    (body: unknown) => api.post(`/products/${product.productId}/prices`, body),
    ['/price-list', `/products/${product.productId}/price`, path],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-base">{product.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {country
              ? t('prices.countryHistory', { name: country.name })
              : t('prices.globalHistory')}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('prices.close')}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPriceMutation.mutate(
              {
                price: Number(price).toFixed(2),
                currency,
                ...(countryId ? { countryId } : {}),
                ...(validFrom ? { validFrom: new Date(validFrom).toISOString() } : {}),
              },
              {
                onSuccess: () => {
                  toast.push('success', t('prices.setDone'));
                  setPrice('');
                  setValidFrom('');
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-price">{t('prices.newPrice')}</Label>
            <Input
              id="new-price"
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-currency">{t('prices.currency')}</Label>
            <Select id="new-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="EUR">EUR</option>
              <option value="DZD">DZD</option>
              <option value="USD">USD</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-from">{t('ledger.from')}</Label>
            <Input
              id="new-from"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={!price || setPriceMutation.isPending} className="w-full">
              {setPriceMutation.isPending ? t('common.saving') : t('prices.set')}
            </Button>
          </div>
          <div className="sm:col-span-4">
            <FormError error={setPriceMutation.error} />
          </div>
        </form>

        {history.isLoading && <LoadingState />}
        {history.data?.length === 0 && (
          <EmptyState
            icon={Tag}
            title={t('prices.noneSet')}
            description={t('prices.noneSetBody')}
          />
        )}
        {history.data && history.data.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th className="text-end">{t('prices.sellsFor')}</Th>
                <Th>{t('ledger.from')}</Th>
                <Th>{t('prices.until')}</Th>
                <Th>{t('prices.setBy')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {history.data.map((row) => (
                <Tr key={row.id}>
                  <Td className="tabular text-end font-semibold">
                    {money(row.price, row.currency)}
                  </Td>
                  <Td className="text-muted-foreground">{formatDate(row.validFrom)}</Td>
                  <Td className="text-muted-foreground">
                    {row.validTo ? formatDate(row.validTo) : '—'}
                  </Td>
                  <Td className="text-muted-foreground">{row.createdBy?.name ?? '—'}</Td>
                  <Td>{row.isCurrent && <Badge variant="success">{t('prices.current')}</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </CardContent>
    </Card>
  );
}