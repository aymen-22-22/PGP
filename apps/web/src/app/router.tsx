import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { LoadingState } from '@/components/ui/states';
import { useIsDesktop } from '@/hooks/use-media-query';
import { DesktopLayout } from '@/layouts/desktop-layout';
import { MobileLayout } from '@/layouts/mobile-layout';
import { isAdmin, useAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/login';

// Every page beyond the shell is code-split: a warehouse phone should download
// the scan screen, not the whole admin back office.
const HomePage = lazy(() => import('@/pages/home'));
const StockPage = lazy(() => import('@/pages/stock'));
const StockWarehousesPage = lazy(() => import('@/pages/stock-warehouses'));
const StockCategoriesPage = lazy(() => import('@/pages/stock-categories'));
const StockProductsPage = lazy(() => import('@/pages/stock-products'));
const StockProduct360Page = lazy(() => import('@/pages/stock-product-360'));
const ScanPage = lazy(() => import('@/pages/scan'));
const ImeiDetailPage = lazy(() => import('@/pages/imei-detail'));
const MovementsPage = lazy(() => import('@/pages/movements'));
const MorePage = lazy(() => import('@/pages/more'));
const PurchasesPage = lazy(() => import('@/pages/purchases'));
const PurchaseDetailPage = lazy(() => import('@/pages/purchase-detail'));
const PurchaseLabelsPage = lazy(() => import('@/pages/purchase-labels'));
const PurchaseReceiveScanPage = lazy(() => import('@/pages/purchase-receive-scan'));
const ReceiptsPage = lazy(() => import('@/pages/receipts'));
const ReceivePage = lazy(() => import('@/pages/receive'));
const SendPage = lazy(() => import('@/pages/send'));
const TransfersPage = lazy(() => import('@/pages/transfers'));
const TransferDetailPage = lazy(() => import('@/pages/transfer-detail'));

const SalesPage = lazy(() => import('@/pages/sales'));
const SaleDetailPage = lazy(() => import('@/pages/sale-detail'));
const ProductsPage = lazy(() => import('@/pages/products'));
const PartnersPage = lazy(() => import('@/pages/partners'));
const WarehousesPage = lazy(() => import('@/pages/warehouses'));
const DeliveryPage = lazy(() => import('@/pages/delivery'));
const DeliveryCarrierPage = lazy(() => import('@/pages/delivery-carrier'));
const UsersPage = lazy(() => import('@/pages/users'));
const AuditLogsPage = lazy(() => import('@/pages/audit-logs'));
const SystemLogsPage = lazy(() => import('@/pages/system-logs'));
const MailSettingsPage = lazy(() => import('@/pages/mail-settings'));
const NotificationsPage = lazy(() => import('@/pages/notifications'));
const PosPage = lazy(() => import('@/pages/pos'));
const CostsPage = lazy(() => import('@/pages/costs'));
const PricesPage = lazy(() => import('@/pages/prices'));
const LandedCostPage = lazy(() => import('@/pages/landed-cost'));
const LedgerPage = lazy(() => import('@/pages/ledger'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <LoadingState label="Checking your session…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Guards an admin-only route in the UI. The API enforces it regardless. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!isAdmin(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AppRouter() {
  const user = useAuth((s) => s.user);
  const isDesktop = useIsDesktop();
  // Admins work at a desk; warehouse staff work on a phone. The viewport wins
  // either way, so an admin on a phone still gets the thumb-friendly shell.
  const Layout = isDesktop && isAdmin(user) ? DesktopLayout : MobileLayout;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          element={
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          }
        >
          <Route index element={<HomePage />} />
          {/* Walking in: warehouse, category, product, then its whole history.
              The old flat list stays as the way to hunt one specific phone. */}
          <Route path="stock" element={<StockWarehousesPage />} />
          <Route path="stock/search" element={<StockPage />} />
          <Route path="stock/:warehouseId" element={<StockCategoriesPage />} />
          <Route path="stock/:warehouseId/product/:productId" element={<StockProduct360Page />} />
          <Route path="stock/:warehouseId/:category" element={<StockProductsPage />} />
          <Route path="ledger/:kind" element={<LedgerPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="imei/:imei" element={<ImeiDetailPage />} />
          <Route path="movements" element={<MovementsPage />} />
          <Route path="more" element={<MorePage />} />

          <Route path="purchases" element={<PurchasesPage />} />
          <Route path="purchases/:id" element={<PurchaseDetailPage />} />
          <Route path="purchases/:id/labels" element={<PurchaseLabelsPage />} />
          <Route path="purchases/:id/receive-scan" element={<PurchaseReceiveScanPage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
          <Route path="receive" element={<ReceivePage />} />
          <Route path="send" element={<SendPage />} />

          <Route path="transfers" element={<TransfersPage />} />
          <Route path="transfers/:id" element={<TransferDetailPage />} />

          <Route path="pos" element={<PosPage />} />
          <Route path="landed-cost/:kind/:id" element={<LandedCostPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="sales/:id" element={<SaleDetailPage />} />
          <Route path="customers" element={<PartnersPage kind="customers" />} />

          <Route
            path="suppliers"
            element={
              <RequireAdmin>
                <PartnersPage kind="suppliers" />
              </RequireAdmin>
            }
          />
          <Route
            path="products"
            element={
              <RequireAdmin>
                <ProductsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="costs"
            element={
              <RequireAdmin>
                <CostsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="prices"
            element={
              <RequireAdmin>
                <PricesPage />
              </RequireAdmin>
            }
          />
          <Route
            path="warehouses"
            element={
              <RequireAdmin>
                <WarehousesPage />
              </RequireAdmin>
            }
          />
          <Route
            path="delivery"
            element={
              <RequireAdmin>
                <DeliveryPage />
              </RequireAdmin>
            }
          />
          <Route
            path="delivery/companies/:id"
            element={
              <RequireAdmin>
                <DeliveryCarrierPage kind="companies" />
              </RequireAdmin>
            }
          />
          <Route
            path="delivery/drivers/:id"
            element={
              <RequireAdmin>
                <DeliveryCarrierPage kind="drivers" />
              </RequireAdmin>
            }
          />
          <Route
            path="users"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />
          <Route
            path="notifications"
            element={
              <RequireAdmin>
                <NotificationsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="settings/email"
            element={
              <RequireAdmin>
                <MailSettingsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="system-logs"
            element={
              <RequireAdmin>
                <SystemLogsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="audit-logs"
            element={
              <RequireAdmin>
                <AuditLogsPage />
              </RequireAdmin>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
