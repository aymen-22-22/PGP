import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { PaymentStatus, SalePayment } from '@/features/sales/payments';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { formatImei } from '@/lib/utils';

interface InvoiceSale {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalAmount: string;
  amountPaid: string;
  balance: string;
  paymentStatus: PaymentStatus;
  createdAt: string;
  completedAt: string | null;
  customer: { name: string; email?: string | null; phone?: string | null; address?: string | null; country?: string | null } | null;
  warehouse: { name: string };
  items: { id: string; quantity: number; unitPrice: string; totalPrice: string; product: { id: string; name: string; sku: string } }[];
  devices: { id: string; imei: string | null; label: { code: string } | null; product: { id?: string; name: string } }[];
  payments: SalePayment[];
}

interface Company {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  footer: string;
}

/**
 * The invoice, laid out for paper. Printing it — or "Save as PDF" in the print
 * dialog — gives the PDF; the browser shapes Arabic and lays out right-to-left
 * properly, which a hand-built PDF would not.
 */
export default function SaleInvoicePage() {
  const { t, money, date, dir } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const sale = useApiQuery<InvoiceSale>(`/sales/${id}`);
  const company = useApiQuery<Company>('/settings/company');
  const ready = sale.data && company.data;

  // Opened from the "Invoice (PDF)" button: go straight to the print dialog.
  useEffect(() => {
    if (!ready || params.get('print') !== '1') return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [ready, params]);

  if (sale.isLoading || company.isLoading) return <LoadingState />;
  if (sale.isError) return <ErrorState error={sale.error} onRetry={() => void sale.refetch()} />;
  const s = sale.data!;
  const c = company.data!;

  const codesFor = (productId: string, name: string) =>
    s.devices
      .filter((d) => (d.product.id ? d.product.id === productId : d.product.name === name))
      .map((d) => (d.imei ? formatImei(d.imei) : d.label?.code))
      .filter(Boolean);

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white" dir={dir}>
      <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-2 px-4 py-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={`/sales/${s.id}`}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {s.number}
          </Link>
        </Button>
        <Button className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          {t('invoice.print')}
        </Button>
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none sm:p-12">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-4 border-emerald-600 pb-6">
          <div className="space-y-0.5">
            <p dir="auto" className="text-xl font-extrabold">{c.name || t('invoice.companyMissing')}</p>
            {c.address && <p dir="auto" className="whitespace-pre-line text-slate-600">{c.address}</p>}
            {(c.phone || c.email) && (
              <p className="text-slate-600">
                <bdi dir="ltr">{[c.phone, c.email].filter(Boolean).join(' · ')}</bdi>
              </p>
            )}
            {c.taxId && (
              <p className="text-slate-600">
                {t('invoice.taxId')}: <bdi dir="ltr">{c.taxId}</bdi>
              </p>
            )}
          </div>
          <div className="text-end">
            <p className="text-3xl font-black uppercase tracking-wide text-emerald-700">{t('invoice.title')}</p>
            <p dir="ltr" className="font-mono text-sm font-semibold">{s.number}</p>
            <p className="text-slate-600">
              {t('invoice.date')}: {date(s.completedAt ?? s.createdAt)}
            </p>
          </div>
        </header>

        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('invoice.billTo')}</p>
            <p dir="auto" className="text-base font-semibold">{s.customer?.name ?? t('sale.walkInCustomer')}</p>
            {s.customer?.address && <p dir="auto" className="whitespace-pre-line text-slate-600">{s.customer.address}</p>}
            {(s.customer?.phone || s.customer?.email) && (
              <p className="text-slate-600">
                <bdi dir="ltr">{[s.customer?.phone, s.customer?.email].filter(Boolean).join(' · ')}</bdi>
              </p>
            )}
          </div>
          <div className="sm:text-end">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('invoice.soldFrom')}</p>
            <p className="font-semibold">{s.warehouse.name}</p>
            <p className="mt-2">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                  s.paymentStatus === 'PAID'
                    ? 'bg-emerald-100 text-emerald-800'
                    : s.paymentStatus === 'PARTIAL'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800'
                }`}
              >
                {t(`payment.status.${s.paymentStatus}`)}
              </span>
            </p>
          </div>
        </section>

        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-600">
              <th className="px-3 py-2 text-start">{t('common.product')}</th>
              <th className="px-3 py-2 text-end">{t('sale.qty')}</th>
              <th className="px-3 py-2 text-end">{t('ledger.unitPrice')}</th>
              <th className="px-3 py-2 text-end">{t('common.total')}</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((item) => {
              const codes = codesFor(item.product.id, item.product.name);
              return (
                <tr key={item.id} className="border-b border-slate-200 align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-semibold">{item.product.name}</p>
                    <p className="font-mono text-[11px] text-slate-500">{item.product.sku}</p>
                    {codes.length > 0 && (
                      <p className="mt-1 font-mono text-[11px] text-slate-600">
                        {t('invoice.imeis')}: {codes.join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{item.quantity}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(item.unitPrice, s.currency)}</td>
                  <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{money(item.totalPrice, s.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section className="mt-6 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5">
            <Row label={t('invoice.total')} value={money(s.totalAmount, s.currency)} strong />
            <Row label={t('payment.paid')} value={money(s.amountPaid, s.currency)} />
            <Row
              label={t('payment.balance')}
              value={money(s.balance, s.currency)}
              className={Number(s.balance) > 0 ? 'text-red-700' : 'text-emerald-700'}
              strong
            />
          </dl>
        </section>

        {s.payments.length > 0 && (
          <section className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('payment.title')}</p>
            <ul className="mt-1 text-slate-700">
              {s.payments.map((p) => (
                <li key={p.id}>
                  {date(p.paidAt)} · {t(`payment.method.${p.method}`)} · {money(p.amount, s.currency)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-10 border-t pt-4 text-center text-[11px] text-slate-500">
          {c.footer ? <p dir="auto" className="whitespace-pre-line">{c.footer}</p> : <p>{t('invoice.thanks')}</p>}
        </footer>
      </article>
    </div>
  );
}

function Row({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'text-base font-bold' : ''} ${className ?? ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
