import { Injectable } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** What every caller needs to know about a device it just resolved. */
export interface ScannedDevice {
  id: string;
  imei: string | null;
  status: DeviceStatus;
  currentWarehouseId: string | null;
  productId: string;
}

export interface ScanResolution {
  /** `code` is what was actually scanned, which is what callers store and echo back. */
  resolved: { device: ScannedDevice; code: string }[];
  missing: string[];
}

const DEVICE_FIELDS = {
  id: true,
  imei: true,
  status: true,
  currentWarehouseId: true,
  productId: true,
} as const;

/**
 * Turns whatever was scanned into the device it stands for.
 *
 * Two things identify a unit. Legacy stock carries an IMEI. Stock received
 * through the label-first workflow has none at all — the printed unit label
 * is its only handle — so a lookup by IMEI alone silently loses every phone
 * booked in that way. Trying IMEI first keeps older scans resolving exactly
 * as they always did.
 *
 * Callers key their own maps off the returned `code` rather than the IMEI,
 * so an error message can name the string the picker actually scanned.
 */
@Injectable()
export class DeviceScanService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(codes: string[]): Promise<ScanResolution> {
    if (codes.length === 0) return { resolved: [], missing: [] };

    const byImei = await this.prisma.device.findMany({
      where: { imei: { in: codes } },
      select: DEVICE_FIELDS,
    });

    const resolved = byImei.map((device) => ({ device, code: device.imei as string }));
    const matched = new Set(resolved.map((r) => r.code));
    const remaining = codes.filter((code) => !matched.has(code));

    if (remaining.length > 0) {
      // Only a label that has actually been scanned in has a device behind it;
      // one still awaiting goods-in resolves to nothing, which is correct.
      const labels = await this.prisma.purchaseUnitLabel.findMany({
        where: { code: { in: remaining }, deviceId: { not: null } },
        select: { code: true, device: { select: DEVICE_FIELDS } },
      });
      for (const label of labels) {
        if (label.device) resolved.push({ device: label.device, code: label.code });
      }
    }

    const found = new Set(resolved.map((r) => r.code));
    return { resolved, missing: codes.filter((code) => !found.has(code)) };
  }

  /** The single device a scan meant, or null. */
  async resolveOne(code: string): Promise<{ device: ScannedDevice; code: string } | null> {
    const { resolved } = await this.resolve([code]);
    return resolved[0] ?? null;
  }
}
