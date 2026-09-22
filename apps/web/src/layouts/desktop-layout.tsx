import { LogOut } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useT } from '@/i18n/provider';
import { navigationFor } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export function DesktopLayout() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const navigate = useNavigate();

  // The same list the phone's More page reads, so a new page appears in both.
  const t = useT();
  const sections = navigationFor(user);

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e bg-card lg:flex print:hidden">
        <div className="border-b px-5 py-4">
          <p className="text-lg font-bold tracking-tight">Phone ERP</p>
          <p className="truncate text-xs text-muted-foreground">
            {user?.warehouseName ?? 'All warehouses'}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
          {sections.map((section) => (
            <div key={section.title} className="mb-4">
              <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(section.title)}
              </p>
              <ul className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {t(label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t p-3">
          <p className="px-2 pb-2 text-sm font-medium">{user?.name}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
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
