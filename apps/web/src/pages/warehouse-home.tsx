import { ChevronRight, ImageIcon, Inbox, Package, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { useAuth } from '@/lib/auth';

interface Incoming {
  total: number;
  items: { product: { id: string; name: string; imageUrl: string | null }; toReceive: number }[];
}

/**
 * A warehouse account's home: the scanner first, then what is coming and what
 * is on the shelf. No sales, no money, no charts.
 */
export default function WarehouseHome() {
  const { t, n } = useI18n();
  const user = useAuth((s) => s.user);
  const incoming = useApiQuery<Incoming>('/ops/incoming', { refetchInterval: 60_000 });
  const dashboard = useApiQuery<{ totals: { available: number } }>('/reports/dashboard');

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">{user?.warehouseName}</p>
        <h1 className="text-2xl font-bold">{t('whHome.hello', { name: user?.name?.split(' ')[0] ?? '' })}</h1>
      </header>

      <Link
        to="/scanner"
        className="flex items-center gap-4 rounded-2xl bg-primary p-5 text-primary-foreground shadow-md transition active:scale-[0.99]"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
          <ScanLine className="h-8 w-8" />
        </span>
        <span className="flex-1">
          <span className="block text-xl font-bold">{t('whHome.scan')}</span>
          <span className="block text-sm opacity-90">{t('whHome.scanHint')}</span>
        </span>
        <ChevronRight className="h-6 w-6 rtl:rotate-180" />
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/scanner" className="rounded-xl border bg-card p-4">
          <Inbox className="h-5 w-5 text-blue-600" />
          <p className="mt-2 text-3xl font-bold tabular-nums text-blue-700">{n(incoming.data?.total ?? 0)}</p>
          <p className="text-sm text-muted-foreground">{t('whHome.incoming')}</p>
        </Link>
        <Link to="/stock" className="rounded-xl border bg-card p-4">
          <Package className="h-5 w-5 text-emerald-600" />
          <p className="mt-2 text-3xl font-bold tabular-nums">{n(dashboard.data?.totals.available ?? 0)}</p>
          <p className="text-sm text-muted-foreground">{t('whHome.inStock')}</p>
        </Link>
      </div>

      {incoming.data && incoming.data.items.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t('ops.incoming')}</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {incoming.data.items.slice(0, 4).map((item) => (
              <li key={item.product.id}>
                <Link to="/scanner" className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                    {item.product.imageUrl ? (
                      <img src={item.product.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.product.name}</span>
                  <span className="shrink-0 text-sm font-semibold text-blue-700">
                    {t('ops.toReceive', { count: item.toReceive })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}
