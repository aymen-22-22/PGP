import { LayoutDashboard, Settings, ShoppingCart, Truck, Wallet } from 'lucide-react';
import { NAV_SECTIONS } from './navigation';

export type AreaId = 'overview' | 'buying' | 'moving' | 'selling' | 'admin';

/**
 * Each part of the work has one colour and one symbol, used on the menu, the
 * page header and the bottom bar, so people always know where they are
 * without reading. Classes are spelled out in full for Tailwind to find them.
 */
export const AREAS: Record<
  AreaId,
  { icon: typeof Truck; text: string; soft: string; solid: string; onDark: string; border: string; label: string }
> = {
  overview: { icon: LayoutDashboard, text: 'text-indigo-600', soft: 'bg-indigo-50 text-indigo-700', solid: 'bg-indigo-600', onDark: 'text-indigo-300', border: 'border-indigo-400', label: 'area.overview' },
  buying: { icon: ShoppingCart, text: 'text-blue-600', soft: 'bg-blue-50 text-blue-700', solid: 'bg-blue-600', onDark: 'text-sky-300', border: 'border-sky-400', label: 'area.buying' },
  moving: { icon: Truck, text: 'text-orange-600', soft: 'bg-orange-50 text-orange-700', solid: 'bg-orange-500', onDark: 'text-orange-300', border: 'border-orange-400', label: 'area.moving' },
  selling: { icon: Wallet, text: 'text-emerald-600', soft: 'bg-emerald-50 text-emerald-700', solid: 'bg-emerald-600', onDark: 'text-emerald-300', border: 'border-emerald-400', label: 'area.selling' },
  admin: { icon: Settings, text: 'text-slate-500', soft: 'bg-slate-100 text-slate-700', solid: 'bg-slate-500', onDark: 'text-slate-300', border: 'border-slate-400', label: 'area.admin' },
};

const BY_SECTION: Record<string, AreaId> = {
  'nav.section.overview': 'overview',
  'nav.section.inbound': 'buying',
  'nav.section.distribution': 'moving',
  'nav.section.outbound': 'selling',
  'nav.section.administration': 'admin',
};

export const areaOfSection = (title: string): AreaId => BY_SECTION[title] ?? 'overview';

/** Pages outside the menu (detail pages, labels…) belong to the area of their list. */
const EXTRA: [string, AreaId][] = [
  ['/receive', 'buying'],
  ['/ledger', 'selling'],
  ['/imei', 'overview'],
  ['/landed-cost', 'buying'],
  ['/lots', 'buying'],
  ['/shipments', 'moving'],
];

export function areaForPath(pathname: string): AreaId | null {
  if (pathname === '/') return 'overview';
  let best: { len: number; area: AreaId } | null = null;
  const consider = (to: string, area: AreaId) => {
    if (to !== '/' && (pathname === to || pathname.startsWith(`${to}/`)) && (!best || to.length > best.len)) {
      best = { len: to.length, area };
    }
  };
  for (const section of NAV_SECTIONS) for (const item of section.items) consider(item.to, areaOfSection(section.title));
  for (const [to, area] of EXTRA) consider(to, area);
  return (best as { area: AreaId } | null)?.area ?? null;
}
