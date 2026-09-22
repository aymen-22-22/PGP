import { Inject, Injectable } from '@nestjs/common';
import { DeviceStatus, MovementType, Prisma } from '@prisma/client';
import { AuditAction, classifyBarcode, ErrorCode } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import { normalizeSingleImei } from '../common/pipes/imei.util';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import { APP_CONFIG } from '../common/tokens';
import type { RequestUser } from '../common/types';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

/**
 * IMEI traceability (spec §21).
 *
 * "Where is this phone, where did it come from, and who touched it" answered
 * from the device row plus its immutable movement ledger.
 */
@Injectable()
export class ImeisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async findByImei(user: RequestUser, rawImei: string) {
    // A label-received phone has no IMEI, so its printed label is the only
    // way to open its history. Anything else is still read as an IMEI.
    const classified = classifyBarcode(rawImei);
    const isLabel = classified.kind === 'LABEL';
    const imei = isLabel
      ? classified.code
      : normalizeSingleImei(rawImei, this.config.imei.enforceChecksum);
    const where: Prisma.DeviceWhereInput = isLabel
      ? { label: { code: imei } }
      : { OR: [{ imei }, { imei2: imei }] };

    const device = await this.prisma.device.findFirst({
      where,
      include: {
        product: true,
        label: { select: { code: true } },
        currentWarehouse: { select: { id: true, name: true, code: true, country: true } },
        purchase: {
          select: {
            id: true,
            number: true,
            purchaseDate: true,
            currency: true,
            supplier: { select: { id: true, name: true, country: true } },
          },
        },
        sale: {
          select: {
            id: true,
            number: true,
            completedAt: true,
            currency: true,
            totalAmount: true,
            customer: { select: { id: true, name: true, country: true } },
          },
        },
      },
    });
    if (!device) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_FOUND,
        isLabel ? 'No phone carries this label.' : 'No phone with this IMEI is known.',
        404,
        { imei },
      );
    }

    await this.assertVisible(user, device.currentWarehouseId, device.id);

    return {
      id: device.id,
      imei: device.imei,
      imei2: device.imei2,
      serialNumber: device.serialNumber,
      // Null unless this unit arrived through the label-first workflow — the
      // only handle it has when there is no IMEI to show instead.
      label: device.label ? { code: device.label.code } : null,
      status: device.status,
      receivedAt: device.receivedAt,
      soldAt: device.soldAt,
      purchaseCost: device.purchaseCost?.toFixed(2) ?? null,
      landedCost: device.landedCost?.toFixed(2) ?? null,
      costCurrency: device.costCurrency,
      product: device.product,
      currentWarehouse: device.currentWarehouse,
      supplier: device.purchase?.supplier ?? null,
      purchase: device.purchase
        ? {
            id: device.purchase.id,
            number: device.purchase.number,
            purchaseDate: device.purchase.purchaseDate,
          }
        : null,
      sale: device.sale
        ? {
            id: device.sale.id,
            number: device.sale.number,
            customer: device.sale.customer,
            completedAt: device.sale.completedAt,
          }
        : null,
    };
  }

  /** The full chronological journey of one phone. */
  async history(user: RequestUser, rawImei: string) {
    const device = await this.findByImei(user, rawImei);

    const movements = await this.prisma.deviceMovement.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        referenceType: true,
        referenceId: true,
        referenceNumber: true,
        createdAt: true,
        metadata: true,
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
        performedBy: { select: { id: true, name: true } },
      },
    });

    // Who actually carried it, for the transfers among these movements — the
    // journal otherwise says a phone moved warehouses with nobody named.
    const transferIds = [
      ...new Set(movements.filter((m) => m.referenceType === 'Transfer').map((m) => m.referenceId!)),
    ];
    const shipments = transferIds.length
      ? await this.prisma.shipment.findMany({
          where: { transferId: { in: transferIds } },
          select: {
            transferId: true,
            carrier: true,
            deliveryCompany: { select: { id: true, name: true } },
            driver: { select: { id: true, name: true } },
          },
        })
      : [];
    const carrierByTransfer = new Map(shipments.map((s) => [s.transferId, s]));

    return {
      device,
      movements: movements.map((m) => {
        const shipment = m.referenceType === 'Transfer' && m.referenceId ? carrierByTransfer.get(m.referenceId) : undefined;
        return {
          ...m,
          carrier: shipment
            ? { name: shipment.deliveryCompany?.name ?? null, driver: shipment.driver?.name ?? null, freeText: shipment.carrier }
            : null,
        };
      }),
    };
  }

  /** Type-ahead over IMEI, serial number and product, used by the scan screen. */
  async search(user: RequestUser, term: string, limit = 20) {
    const cleaned = (term ?? '').trim();
    if (cleaned.length < 3) return { data: [] };

    const where: Prisma.DeviceWhereInput = {
      ...this.access.filterFor<Prisma.DeviceWhereInput>(user, 'currentWarehouseId'),
      OR: [
        { imei: { contains: cleaned } },
        { imei2: { contains: cleaned } },
        { serialNumber: { contains: cleaned, mode: 'insensitive' } },
        { product: { name: { contains: cleaned, mode: 'insensitive' } } },
        { product: { sku: { contains: cleaned, mode: 'insensitive' } } },
      ],
    };

    const data = await this.prisma.device.findMany({
      where,
      take: Math.min(limit, 50),
      orderBy: { receivedAt: 'desc' },
      select: {
        id: true,
        imei: true,
        status: true,
        product: { select: { id: true, name: true, sku: true } },
        currentWarehouse: { select: { id: true, name: true } },
      },
    });
    return { data };
  }

  /**
   * Validates one scanned barcode against a context without changing anything,
   * so the scan screen can say "accepted" or "wrong warehouse" instantly.
   *
   * Decides what the payload is first (IMEI / serial / EAN-UPC / other) and
   * resolves each per the scan decision tree: known IMEI or serial that meets
   * the context is accepted; an unknown one is offered as new only while
   * receiving stock; an EAN resolves to its product; anything else is refused.
   */
  async verifyScan(
    user: RequestUser,
    rawOrImei: string,
    context: {
      warehouseId?: string;
      transferId?: string;
      expectStatus?: DeviceStatus;
      /** Inside goods-in: an unknown IMEI/serial becomes a new unit. */
      receiving?: boolean;
    },
  ) {
    const classified = classifyBarcode(rawOrImei);
    if (classified.kind === 'IMEI') {
      return this.resolveImei(user, classified.imei, context);
    }
    if (classified.kind === 'LABEL') {
      return this.resolveLabel(user, classified.code, context);
    }
    if (classified.kind === 'SERIAL') {
      return this.resolveSerial(user, classified.serial, context);
    }
    if (classified.kind === 'EAN') {
      return this.resolveEan(classified);
    }
    return {
      kind: 'OTHER',
      raw: rawOrImei,
      imei: rawOrImei,
      accepted: false,
      code: ErrorCode.UNRECOGNIZED_BARCODE,
      message: 'This barcode was not recognized. Retry the scan or enter the value manually.',
    };
  }

  /**
   * A unit label reserved when the order was placed.
   *
   * Until goods-in it has no device behind it, which is not an error worth
   * shouting about: it means the phone has not arrived, and saying so is more
   * use than "unknown code".
   */
  private async resolveLabel(
    user: RequestUser,
    code: string,
    context: { warehouseId?: string; transferId?: string; expectStatus?: DeviceStatus; receiving?: boolean },
  ) {
    const label = await this.prisma.purchaseUnitLabel.findUnique({
      where: { code },
      select: {
        code: true,
        receivedAt: true,
        device: {
          select: {
            id: true,
            imei: true,
            imei2: true,
            serialNumber: true,
            status: true,
            currentWarehouseId: true,
            product: { select: { id: true, name: true, sku: true } },
            currentWarehouse: { select: { id: true, name: true } },
          },
        },
        purchaseItem: {
          select: { purchase: { select: { number: true, warehouseId: true } } },
        },
      },
    });

    if (!label) {
      return {
        kind: 'LABEL',
        imei: code,
        code: ErrorCode.IMEI_NOT_FOUND,
        accepted: false,
        message: 'Unknown label.',
      };
    }

    if (!label.device) {
      return {
        kind: 'LABEL',
        imei: code,
        accepted: Boolean(context.receiving),
        code: context.receiving ? 'LABEL_AWAITING_RECEIPT' : ErrorCode.IMEI_NOT_FOUND,
        message: context.receiving
          ? `Not yet received — scan it in against ${label.purchaseItem.purchase.number}.`
          : `This label has not been received yet (${label.purchaseItem.purchase.number}).`,
        device: null,
      };
    }

    const blocked = await this.contextBlock(user, label.device, context);
    if (blocked) return { kind: 'LABEL', imei: code, ...blocked, device: label.device };
    return { kind: 'LABEL', imei: code, accepted: true, device: label.device };
  }

  private async resolveImei(
    user: RequestUser,
    imei: string,
    context: { warehouseId?: string; transferId?: string; expectStatus?: DeviceStatus; receiving?: boolean },
  ) {
    // classifyBarcode (the only caller of resolveImei) already guarantees a
    // Luhn-valid, normalised 15-digit IMEI.
    const device = await this.prisma.device.findUnique({
      where: { imei },
      select: {
        id: true,
        imei: true,
        imei2: true,
        serialNumber: true,
        status: true,
        currentWarehouseId: true,
        product: { select: { id: true, name: true, sku: true } },
        currentWarehouse: { select: { id: true, name: true } },
      },
    });

    if (!device) {
      if (context.receiving) {
        return {
          kind: 'IMEI',
          imei,
          serialNumber: null,
          accepted: true,
          code: 'IMEI_NEW_ACCEPTED',
          message: 'New IMEI — will be received as a new unit.',
          device: null,
        };
      }
      return { kind: 'IMEI', imei, accepted: false, code: ErrorCode.IMEI_NOT_FOUND, message: 'Unknown IMEI.' };
    }

    const blocked = await this.contextBlock(user, device, context);
    if (blocked) return { kind: 'IMEI', imei, ...blocked, device };
    return { kind: 'IMEI', imei, accepted: true, device };
  }

  private async resolveSerial(
    user: RequestUser,
    serial: string,
    context: { warehouseId?: string; transferId?: string; expectStatus?: DeviceStatus; receiving?: boolean },
  ) {
    const device = await this.prisma.device.findFirst({
      where: { serialNumber: { equals: serial, mode: 'insensitive' } },
      select: {
        id: true,
        imei: true,
        imei2: true,
        serialNumber: true,
        status: true,
        currentWarehouseId: true,
        product: { select: { id: true, name: true, sku: true } },
        currentWarehouse: { select: { id: true, name: true } },
      },
    });

    if (!device) {
      if (context.receiving) {
        return {
          kind: 'SERIAL',
          serial,
          accepted: true,
          code: 'SERIAL_NEW_ACCEPTED',
          message: 'New serial — will be received as a unit awaiting its IMEI.',
          device: null,
        };
      }
      return {
        kind: 'SERIAL',
        serial,
        imei: null,
        accepted: false,
        code: ErrorCode.SERIAL_NOT_FOUND,
        message: 'No phone with this serial number is known.',
      };
    }

    const blocked = await this.contextBlock(user, device, context);
    if (blocked) return { kind: 'SERIAL', serial, imei: device.imei, ...blocked, device };
    return { kind: 'SERIAL', serial, imei: device.imei, accepted: true, device };
  }

  private async resolveEan(classified: { kind: 'EAN'; digits: string; eanType: 'EAN' | 'UPC' }) {
    const product = await this.prisma.product.findFirst({
      where: { barcode: { equals: classified.digits } },
      select: { id: true, name: true, sku: true, barcode: true, tracking: true },
    });
    if (!product) {
      return {
        kind: 'EAN',
        ean: classified.digits,
        eanType: classified.eanType,
        imei: null,
        accepted: false,
        code: ErrorCode.PRODUCT_BARCODE_NOT_FOUND,
        message: `That is a ${classified.eanType === 'EAN' ? 'EAN-13' : 'UPC'} product barcode, but it matches no known product. Select the product manually.`,
      };
    }
    return {
      kind: 'EAN',
      ean: classified.digits,
      eanType: classified.eanType,
      imei: null,
      accepted: true,
      code: 'PRODUCT',
      message: `Product barcode — ${product.name}.`,
      product: { id: product.id, name: product.name, sku: product.sku },
    };
  }

  /** The context checks shared by IMEI and serial resolutions, or null for clear. */
  private async contextBlock(
    user: RequestUser,
    device: {
      id: string;
      imei: string | null;
      status: DeviceStatus;
      currentWarehouseId: string | null;
    },
    context: { warehouseId?: string; transferId?: string; expectStatus?: DeviceStatus; receiving?: boolean },
  ): Promise<{ accepted: false; code: ErrorCode; message: string } | null> {
    if (device.status === DeviceStatus.PENDING_IDENTIFICATION) {
      return {
        accepted: false,
        code: ErrorCode.IMEI_NOT_AVAILABLE,
        message: 'This phone is pending its IMEI — identify it before use.',
      };
    }
    if (context.transferId) {
      const line = await this.prisma.transferDevice.findFirst({
        where: { transferId: context.transferId, deviceId: device.id },
        select: { receivedAt: true },
      });
      if (!line) {
        return { accepted: false, code: ErrorCode.IMEI_NOT_IN_TRANSFER, message: 'This phone is not part of this shipment.' };
      }
      if (line.receivedAt) {
        return { accepted: false, code: ErrorCode.ALREADY_RECEIVED, message: 'This phone has already been received.' };
      }
      return null;
    }

    const expectedWarehouse = context.warehouseId ?? user.warehouseId;
    if (expectedWarehouse && device.currentWarehouseId !== expectedWarehouse) {
      return {
        accepted: false,
        code: ErrorCode.IMEI_WRONG_WAREHOUSE,
        message: 'This phone does not belong to this warehouse.',
      };
    }
    if (device.status === DeviceStatus.SOLD) {
      return { accepted: false, code: ErrorCode.IMEI_ALREADY_SOLD, message: 'This phone has already been sold.' };
    }
    if (context.expectStatus && device.status !== context.expectStatus) {
      return {
        accepted: false,
        code: ErrorCode.IMEI_NOT_AVAILABLE,
        message: `This phone is ${device.status.toLowerCase().replace('_', ' ')}.`,
      };
    }
    return null;
  }

  /**
   * Attaches the IMEI (read via *#06# or the box label) to a unit that was
   * received by serial number alone. The unit becomes sellable stock.
   */
  async identify(
    user: RequestUser,
    deviceId: string,
    dto: { imei: string; imei2?: string | null },
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        imei: true,
        imei2: true,
        serialNumber: true,
        status: true,
        currentWarehouseId: true,
        product: { select: { name: true, sku: true } },
        currentWarehouse: { select: { id: true, name: true } },
      },
    });
    if (!device) throw BusinessError.notFound('Device', deviceId);
    this.access.assertAccess(user, device.currentWarehouseId);

    if (device.status !== DeviceStatus.PENDING_IDENTIFICATION) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Only a unit awaiting its IMEI can be identified; this phone is ${device.status.toLowerCase().replace('_', ' ')}.`,
      );
    }

    const imei = normalizeSingleImei(dto.imei, this.config.imei.enforceChecksum);
    const imei2 = dto.imei2 ? normalizeSingleImei(dto.imei2, this.config.imei.enforceChecksum) : null;

    const clash = await this.prisma.device.findUnique({ where: { imei }, select: { id: true } });
    if (clash && clash.id !== device.id) {
      throw BusinessError.conflict(ErrorCode.IMEI_ALREADY_EXISTS, `IMEI ${imei} is already used by another phone.`);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.device.update({
        where: { id: device.id },
        data: { imei, imei2, status: DeviceStatus.IN_STOCK },
        select: { id: true, imei: true, imei2: true, serialNumber: true, status: true },
      });
      await tx.deviceMovement.create({
        data: {
          deviceId: device.id,
          type: MovementType.IDENTIFIED,
          fromWarehouseId: device.currentWarehouseId,
          toWarehouseId: device.currentWarehouseId,
          performedById: user.id,
          createdAt: now,
          metadata: {
            imei,
            serialNumber: device.serialNumber,
            product: device.product.name,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return saved;
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.IDENTIFY_DEVICE,
      entityType: 'Device',
      entityId: device.id,
      metadata: {
        imei,
        serialNumber: device.serialNumber,
        warehouse: device.currentWarehouse?.name ?? null,
      },
    });

    return updated;
  }

  /**
   * A warehouse user may look up a phone that is currently theirs, and a phone
   * they have handled in the past — otherwise traceability would break the
   * moment stock moves on. Anything else is refused.
   */
  private async assertVisible(
    user: RequestUser,
    warehouseId: string | null,
    deviceId: string,
  ): Promise<void> {
    if (this.access.isAdmin(user)) return;
    if (warehouseId && user.warehouseId === warehouseId) return;

    const touched = await this.prisma.deviceMovement.findFirst({
      where: {
        deviceId,
        OR: [{ fromWarehouseId: user.warehouseId }, { toWarehouseId: user.warehouseId }],
      },
      select: { id: true },
    });
    if (!touched) throw BusinessError.forbiddenWarehouse();
  }
}
