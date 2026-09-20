import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';

export interface MovementInput {
  deviceId: string;
  type: MovementType;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  performedById?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes the immutable device ledger. Every status or location change of a
 * device must be accompanied by exactly one movement row, written inside the
 * same transaction as the change itself.
 */
@Injectable()
export class MovementService {
  async record(tx: Prisma.TransactionClient, input: MovementInput): Promise<void> {
    await this.recordMany(tx, [input]);
  }

  async recordMany(tx: Prisma.TransactionClient, inputs: MovementInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await tx.deviceMovement.createMany({
      data: inputs.map((m) => ({
        deviceId: m.deviceId,
        type: m.type,
        fromWarehouseId: m.fromWarehouseId ?? null,
        toWarehouseId: m.toWarehouseId ?? null,
        referenceType: m.referenceType ?? null,
        referenceId: m.referenceId ?? null,
        referenceNumber: m.referenceNumber ?? null,
        performedById: m.performedById ?? null,
        metadata: m.metadata ?? Prisma.JsonNull,
      })),
    });
  }
}
