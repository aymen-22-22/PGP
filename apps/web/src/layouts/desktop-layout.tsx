import { ChevronDown, LogOut } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { isAdmin, useAuth } from '@/lib/auth';
import { useT } from '@/i18n/provider';
import { AREAS, areaOfSection } from '@/lib/areas';
import { navigationFor } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const COLLAPSED_KEY = 'sidebar.collapsed';

export function DesktopLayout() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const navigate = useNavigate();

  // The same list the phone's More page reads, so a new page appears in both.
  const t = useT();
  const sections = navigationFor(user);
  const { pathname } = useLocation();

  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggle = (title: string) =>
    setCollapsed((current) => {
      const next = current.includes(title) ? current.filter((x) => x !== title) : [...current, title];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Not remembered in private mode; the sidebar still works.
      }
      return next;
    });

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex print:hidden">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-sidebar-accent text-sm font-bold" aria-hidden>
            PE
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight tracking-tight">Phone ERP</p>
            <p className="truncate text-xs text-sidebar-muted">
              {isAdmin(user) ? t('more.allWarehouses') : (user?.warehouseName ?? t('more.allWarehouses'))}
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
          {sections.map((section) => {
            const hasActive = section.items.some((item) =>
              item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`),
            );
            const open = hasActive || !collapsed.includes(section.title);
            const area = AREAS[areaOfSection(section.title)];
            return (
              <div key={section.title} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggle(section.title)}
                  disabled={hasActive}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground disabled:cursor-default disabled:hover:text-sidebar-muted"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', area.solid)} aria-hidden />
                    {t(section.title)}
                  </span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90', hasActive && 'opacity-0')}
                    aria-hidden
                  />
                </button>
                {open && (
                  <ul className="space-y-px">
                    {section.items.map(({ to, label, icon: Icon }) => (
                      <li key={to}>
                        <NavLink
                          to={to}
                          end={to === '/'}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded border-s-2 px-2.5 py-1.5 text-sm transition-colors',
                              isActive
                                ? cn('bg-sidebar-accent font-semibold text-sidebar-foreground', area.border)
                                : 'border-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                            )
                          }
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', area.onDark)} aria-hidden />
                          {t(label)}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-2 pb-2 text-sm font-medium">{user?.name}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 print:p-0">
        <Outlet />
      </main>
    </div>
  );
}
