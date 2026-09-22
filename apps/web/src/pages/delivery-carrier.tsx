import { ArrowLeft, ArrowRight, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { buildQuery, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';

interface ShipmentRow {
  id: string;
  number: string;
  status: 'PREPARING' | 'IN_TRANSIT' | 'DELIVERED' | 'RECEIVED';
  shippedAt: string | null;
  receivedAt: string | null;
  transfer: {
    id: string;
    number: string;
    sourceWarehouse: { id: string; name: string };
    destinationWarehouse: { id: string; name: string };
    items: { productId: string; name: string; sku: string; quantity: number }[];
  };
}

const STATUSES: ShipmentRow['status'][] = ['PREPARING', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED'];

/**
 * Everything one transport firm or driver has carried — admin-only, since who
 * moved what is office information, not something a warehouse floor needs.
 */
export default function DeliveryCarrierPage({ kind }: { kind: 'companies' | 'drivers' }) {
  const { t, dateTime } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const path = `/delivery/${kind}/${id}/shipments${buildQuery({ status: status || undefined, page, pageSize: 25 })}`;
  const list = useApiQuery<{
    carrier: { id: string; name: string };
    data: ShipmentRow[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>(path);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
        <Link to="/delivery">
          <ArrowLeft className="h-4 w-4" />
          {t('delivery.title')}
        </Link>
      </Button>

      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          {list.data?.carrier.name ?? (kind === 'companies' ? t('delivery.company') : t('delivery.driver'))}
        </h1>
        <p className="text-sm text-muted-foreground">{t('delivery.carrierShipmentsLead')}</p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="carrier-status">{t('common.status')}</Label>
            <Select
              id="carrier-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('delivery.everyStatus')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s === 'IN_TRANSIT' ? 'inTransit' : s.toLowerCase()}`)}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {list.isLoading && <LoadingState />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.data.length === 0 && (
        <EmptyState icon={Truck} title={t('delivery.noShipments')} description={t('delivery.noShipmentsBody')} />
      )}

      {list.data && list.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('transfer.shipment')}</Th>
                <Th>{t('common.route')}</Th>
                <Th>{t('common.products')}</Th>
                <Th>{t('common.status')}</Th>
                <Th>{t('transfer.shipped')}</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((shipment) => (
                <Tr key={shipment.id}>
                  <Td className="font-medium">
                    <Link to={`/transfers/${shipment.transfer.id}`} className="tabular hover:underline">
                      {shipment.transfer.number}
                    </Link>
                  </Td>
                  <Td className="flex items-center gap-1 text-sm text-muted-foreground">
                    {shipment.transfer.sourceWarehouse.name}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                    {shipment.transfer.destinationWarehouse.name}
                  </Td>
                  <Td className="max-w-[16rem] truncate text-sm text-muted-foreground">
                    {shipment.transfer.items.map((i) => `${i.name} ×${i.quantity}`).join(', ') || '—'}
                  </Td>
                  <Td>
                    <StatusBadge status={shipment.status} />
                  </Td>
                  <Td className="text-sm text-muted-foreground">
                    {shipment.shippedAt ? dateTime(shipment.shippedAt) : t('transfer.notYet')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination meta={list.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
