import * as React from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { bottomTabsFor, NAV_SECTIONS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const MENU_PAGES = new Set(NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.to)));

/**
 * Goes back the way the user came.
 *
 * On a phone most pages are reached from the More menu, which left no way back
 * except the browser's own gesture. Retracing the actual history is what people
 * expect from a back button — but landing straight on a URL has nothing behind
 * it, and pressing back would walk out of the application. React Router stamps
 * an index onto each entry it creates; at zero there is nowhere of ours to go,
 * so the dashboard stands in.
 */
export function BackButton({ label = 'Back' }: { label?: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);

  // A menu page is a starting point: the sidebar is always there on a desktop,
  // and the bottom bar is on a phone. Pages reached through More still need it.
  if (bottomTabsFor(user).includes(pathname)) return null;
  const hideOnDesktop = MENU_PAGES.has(pathname);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ms-2 gap-1 self-start', hideOnDesktop && 'lg:hidden')}
      onClick={() => {
        const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (index > 0) navigate(-1);
        else navigate('/');
      }}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}

export function PageHeader({
  title,
  description,
  action,
  back = true,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Set false on a page that is itself a starting point. */
  back?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {back && <BackButton />}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="search"
        className="ps-9"
        aria-label={placeholder}
      />
    </div>
  );
}
