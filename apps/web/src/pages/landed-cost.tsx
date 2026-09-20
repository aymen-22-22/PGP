import { ArrowLeft, FileText, Printer } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { titleCase } from '@/lib/utils';

interface Statement {
  document: { kind: string; title: string; reference: string; generatedAt: string; note: string };
  goods: {
    product: { name: string; sku: string };
    lot: { id: string; number: string } | null;
    supplier: string | null;
    purchase: string | null;
    arrivedVia: string | null;
    units: number;
    warehouse: { name: string; code: string; country: string };
    arrivedAt: string;
    receivedBy: string | null;
  };
  journey: {
    type: string;
    from: string | null;
    to: string | null;
    reference: string | null;
    at: string;
    by: string | null;
    units: number;
  }[];
  costs: {
    currency: string;
    purchase: { label: string; perUnit: string; amount: string };
    components: {
      costDocumentId: string;
      number: string;
      type: string;
      description: string | null;
      billedAmount: string;
      billedCurrency: string;
      exchangeRate: string;
      amount: string;
      perUnit: string;
      allocation: string;
      incurredAt: string;
      status: string;
    }[];
    componentsTotal: string;
    landedTotal: string;
    unitLandedCost: string;
  };
  unitCostSpread: { unitCost: string; units: number }[];
  uniform: boolean;
}

/**
 * The document the business asked for: what this batch cost to get here, and
 * every bill that made up the figure.
 */
export default function LandedCostPage() {
  const { t, money, dateTime, n } = useI18n();
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const [params] = useSearchParams();
  const back = params.get('back');

  const query = useApiQuery<Statement>(`/landed-cost/${kind}/${id}`);

  if (query.isLoading) return <LoadingState label={t('landed.building')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const s = query.data!;
  const c = s.costs;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
          <Link to={back ?? '/receipts'}>
            <ArrowLeft className="h-4 w-4" />
            {t('landed.back')}
          </Link>
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          {t('landed.print')}
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                {s.document.title}
              </p>
              <h1 className="tabular text-2xl font-bold">{s.document.reference}</h1>
              <p className="text-sm text-muted-foreground">
                {s.goods.product.name} · {s.goods.product.sku}
              </p>
            </div>
            <div className="text-end">
              <p className="tabular text-stat">{n(s.goods.units)}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('landed.units')}</p>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Field label={t('landed.supplier')} value={s.goods.supplier ?? '—'} />
            <Field label={t('products.purchase')} value={s.goods.purchase ?? '—'} mono />
            <Field label={t('landed.lot')} value={s.goods.lot?.number ?? '—'} mono />
            <Field label={t('landed.arrivedVia')} value={s.goods.arrivedVia ?? '—'} mono />
            <Field label={t('landed.warehouse')} value={s.goods.warehouse.name} />
            <Field label={t('landed.arrived')} value={dateTime(s.goods.arrivedAt)} />
            {s.goods.receivedBy && <Field label={t('landed.receivedBy')} value={s.goods.receivedBy} />}
          </dl>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('landed.journey')}
            </h2>
            <ol className="relative space-y-0 border-s-2 border-border ps-5">
              {s.journey.map((leg, index) => (
                <li key={`${leg.type}-${index}`} className="relative pb-4 last:pb-0">
                  <span className="absolute -start-[1.6rem] mt-1.5 h-3 w-3 rounded-full border-2 border-border bg-card" />
                  <p className="text-sm font-medium">
                    {titleCase(leg.type)}
                    {' · '}
                    <span className="font-normal text-muted-foreground">
                      {leg.from && leg.to ? `${leg.from} → ${leg.to}` : (leg.to ?? leg.from ?? '—')}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('costs.unitLabel', { count: leg.units })} · {dateTime(leg.at)}
                    {leg.reference && ` · ${leg.reference}`}
                    {leg.by && ` · ${leg.by}`}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('landed.costBuildUp')}
            </h2>
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('landed.cost')}</Th>
                  <Th>{t('landed.billed')}</Th>
                  <Th className="text-end">{t('landed.perUnit')}</Th>
                  <Th className="text-end">{t('common.total')}</Th>
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td className="font-medium">{t('products.purchase')}</Td>
                  <Td className="text-muted-foreground">—</Td>
                  <Td className="tabular text-end">{money(c.purchase.perUnit, c.currency)}</Td>
                  <Td className="tabular text-end">{money(c.purchase.amount, c.currency)}</Td>
                </Tr>
                {c.components.map((comp) => (
                  <Tr key={comp.costDocumentId}>
                    <Td>
                      <span className="font-medium">{titleCase(comp.type)}</span>
                      {comp.description && (
                        <span className="block text-xs text-muted-foreground">{comp.description}</span>
                      )}
                      <span className="tabular block text-xs text-muted-foreground">{comp.number}</span>
                    </Td>
                    <Td className="text-muted-foreground">
                      {comp.billedCurrency === c.currency ? (
                        money(comp.billedAmount, comp.billedCurrency)
                      ) : (
                        <>
                          {money(comp.billedAmount, comp.billedCurrency)}
                          <span className="tabular block text-xs">
                            {t('landed.atRate', { rate: Number(comp.exchangeRate).toFixed(6) })}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td className="tabular text-end">{money(comp.perUnit, c.currency)}</Td>
                    <Td className="tabular text-end">{money(comp.amount, c.currency)}</Td>
                  </Tr>
                ))}
                <Tr className="border-t-2 font-bold">
                  <Td>{t('landed.landedCost')}</Td>
                  <Td />
                  <Td className="tabular text-end text-base">
                    {money(c.unitLandedCost, c.currency)}
                  </Td>
                  <Td className="tabular text-end text-base">
                    {money(c.landedTotal, c.currency)}
                  </Td>
                </Tr>
              </tbody>
            </TableWrap>
          </section>

          {!s.uniform && (
            <section className="rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-sm font-semibold">{t('landed.notUniform')}</p>
              <p className="mb-2 text-xs text-muted-foreground">{t('landed.notUniformLead')}</p>
              <ul className="flex flex-wrap gap-2">
                {s.unitCostSpread.map((row) => (
                  <li key={row.unitCost}>
                    <Badge variant="outline">
                      {t('costs.unitsAt', { count: row.units, amount: money(row.unitCost, c.currency) })}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="border-t pt-3 text-xs text-muted-foreground">
            <p>{s.document.note}</p>
            <p className="mt-1">{t('landed.produced', { when: dateTime(s.document.generatedAt) })}</p>
          </footer>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${mono ? 'tabular' : ''}`}>{value}</dd>
    </div>
  );
}
