import {
  Banknote,
  BarChart3,
  ClipboardCheck,
  Home,
  MoreHorizontal,
  Package,
  ScanLine,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { isAdmin, useAuth } from '@/lib/auth';
import { useT } from '@/i18n/provider';
import { sellsAtCounter } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Bottom navigation for warehouse staff on a phone (spec §30).
 *
 * Five slots, arranged around the thumb: inbound work on the left, the scanner
 * in the middle where it is easiest to reach, outbound movement on the right.
 * Everything else lives on the More page, which lists every page the user may
 * open — see lib/navigation.ts.
 */
const TABS = [
  { to: '/purchases', label: 'nav.purchases', icon: ShoppingCart },
  { to: '/sales', label: 'nav.sales', icon: BarChart3 },
  { to: '/scan', label: 'nav.scan', icon: ScanLine, centre: true },
  { to: '/transfers', label: 'nav.transfers', icon: Truck },
  { to: '/stock', label: 'nav.stock', icon: Package },
];

/**
 * Where stock is actually sold, the till takes the Sales slot.
 *
 * Counter staff need the screen that takes money, not the list of past orders —
 * Sales is still one tap away under More.
 */
const SELLING_TABS = TABS.map((tab) =>
  tab.to === '/sales' ? { to: '/pos', label: 'nav.pos', icon: Banknote } : tab,
);

/**
 * Selling is an admin function (spec change): a warehouse account gets the
 * receiving history in the outbound slot instead of a till or a sales list
 * the API would refuse it anyway.
 */
const WAREHOUSE_TABS = TABS.map((tab) =>
  tab.to === '/sales' ? { to: '/receipts', label: 'nav.receipts', icon: ClipboardCheck } : tab,
);

export function MobileLayout() {
  const user = useAuth((s) => s.user);
  const t = useT();
  const tabs = !isAdmin(user) ? WAREHOUSE_TABS : sellsAtCounter(user) ? SELLING_TABS : TABS;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 pt-safe backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight">{user?.warehouseName ?? 'Phone ERP'}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.name}</p>
          </div>

          {/* Home and More sit up here rather than in the bar, so all five
              bottom slots go to the work itself. */}
          <nav className="flex shrink-0 items-center gap-1" aria-label="Shortcuts">
            <HeaderLink to="/" label={t('nav.home')} icon={Home} end />
            <HeaderLink to="/more" label={t('nav.more')} icon={MoreHorizontal} />
          </nav>
        </div>
      </header>

      <main className="flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-safe backdrop-blur"
        aria-label="Main"
      >
        <ul className="mx-auto flex max-w-lg">
          {tabs.map(({ to, label, icon: Icon, centre }) => (
            // The raised scanner makes this row taller than a plain tab, so the
            // anchors must fill that height or the other four hang from the top.
            <li key={to} className="flex flex-1">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex w-full touch-target flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-center text-[0.65rem] font-medium leading-tight transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* The scanner is the one thing used hundreds of times a
                        day, so it is given a target you cannot miss. */}
                    <span
                      className={cn(
                        'flex items-center justify-center',
                        centre &&
                          cn(
                            'h-10 w-10 rounded-full',
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-primary/10 text-primary',
                          ),
                      )}
                    >
                      <Icon
                        className={cn(centre ? 'h-6 w-6' : 'h-5 w-5', isActive && !centre && 'stroke-[2.5]')}
                        aria-hidden
                      />
                    </span>
                    {t(label)}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function HeaderLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex h-11 w-11 items-center justify-center rounded-md transition-colors',
          isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden />
    </NavLink>
  );
}
