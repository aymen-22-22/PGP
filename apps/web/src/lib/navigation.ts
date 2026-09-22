import {
  Banknote,
  BarChart3,
  Building2,
  ClipboardCheck,
  Coins,
  FileClock,
  Inbox,
  LayoutDashboard,
  Mail,
  Package,
  ScanLine,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import type { AuthUser } from '@phone-erp/shared-types';
import { isAdmin } from './auth';

export interface NavItem {
  to: string;
  /** A phrase key, not a phrase — the layouts translate it when they draw it. */
  label: string;
  icon: typeof Package;
}

export interface NavSection {
  /** A phrase key, as with items. */
  title: string;
  items: NavItem[];
}

/**
 * Every page in the application, in one list.
 *
 * The desktop sidebar and the phone's More page both read from here. They used
 * to keep separate lists, and the phone's quietly fell eleven pages behind —
 * shipments, receipts, costs, prices, products and the rest were reachable only
 * by typing the URL. One list cannot drift from itself.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'nav.section.overview',
    items: [
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard },
      { to: '/stock', label: 'nav.stock', icon: Package },
      { to: '/scan', label: 'nav.scan', icon: ScanLine },
      { to: '/movements', label: 'nav.movements', icon: Truck },
    ],
  },
  {
    title: 'nav.section.inbound',
    items: [
      { to: '/purchases', label: 'nav.purchases', icon: ShoppingCart },
      { to: '/receive', label: 'nav.receive', icon: Inbox },
      { to: '/receipts', label: 'nav.receipts', icon: ClipboardCheck },
      { to: '/costs', label: 'nav.costs', icon: Coins },
    ],
  },
  {
    title: 'nav.section.distribution',
    items: [
      { to: '/transfers', label: 'nav.transfers', icon: Truck },
    ],
  },
  {
    title: 'nav.section.outbound',
    items: [
      { to: '/pos', label: 'nav.pos', icon: Banknote },
      { to: '/sales', label: 'nav.sales', icon: BarChart3 },
      { to: '/prices', label: 'nav.prices', icon: Tag },
      { to: '/customers', label: 'nav.customers', icon: Building2 },
      { to: '/suppliers', label: 'nav.suppliers', icon: Building2 },
    ],
  },
  {
    title: 'nav.section.administration',
    items: [
      { to: '/products', label: 'nav.products', icon: Package },
      { to: '/warehouses', label: 'nav.warehouses', icon: Warehouse },
      { to: '/users', label: 'nav.users', icon: Users },
      { to: '/notifications', label: 'nav.notifications', icon: Mail },
      { to: '/audit-logs', label: 'nav.audit', icon: FileClock },
    ],
  },
];

/** Pages a warehouse user has no business on — the API refuses them anyway. */
const ADMIN_ONLY_PAGES = ['/suppliers', '/costs', '/prices', '/pos', '/sales'];

/** The sections this user may actually open, with empty sections dropped. */
export function navigationFor(user: AuthUser | null): NavSection[] {
  if (isAdmin(user)) return NAV_SECTIONS;

  return NAV_SECTIONS.filter((section) => section.title !== 'nav.section.administration')
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !ADMIN_ONLY_PAGES.includes(item.to)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * The same sections with certain destinations removed.
 *
 * The More page uses this to leave out whatever already has its own button, so
 * nothing is listed twice.
 */
export function navigationExcluding(user: AuthUser | null, exclude: string[]): NavSection[] {
  return navigationFor(user)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !exclude.includes(item.to)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Whether this user works a counter rather than a warehouse floor.
 *
 * The country says it outright, which is far steadier than matching on a
 * warehouse name. The bottom bar gives them the till where everyone else gets
 * the sales list, and the More page uses the same answer so neither lists a
 * page the other already shows.
 */
export const sellsAtCounter = (user: AuthUser | null): boolean => user?.countryCode === 'DZ';

/** The five destinations on the phone's bottom bar, for this user. */
export const bottomTabsFor = (user: AuthUser | null): string[] =>
  isAdmin(user)
    ? ['/purchases', sellsAtCounter(user) ? '/pos' : '/sales', '/scan', '/transfers', '/stock']
    : // Selling is an admin function; a warehouse account gets Receive (its
      // incoming purchase orders and transfers) and Send (the transfer page)
      // instead of Purchases and Sales; past receipts take the slot Send freed up.
      ['/receive', '/transfers', '/scan', '/receipts', '/stock'];
