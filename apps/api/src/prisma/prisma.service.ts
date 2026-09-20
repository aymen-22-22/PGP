import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /** Test helper: wipes every table in dependency order. Never used in production code paths. */
  async truncateAll(): Promise<void> {
    if (process.env.NODE_ENV === 'production') throw new Error('truncateAll is not allowed in production');
    await this.$executeRawUnsafe(`
      TRUNCATE TABLE
        "CostEntry","CostDocument","ProductPrice","ReceiptLine","Receipt","ReturnItem","Return",
        "DeviceMovement","StockMovement","StockLevel","TransferDevice","TransferItem","Shipment","Transfer","SaleItem","Sale",
        "Device","Lot","PurchaseItem","Purchase","AuditLog","Product","Supplier","Customer","User",
        "CostCenter","Warehouse","Country","DocumentCounter","Brand","Notification"
      RESTART IDENTITY CASCADE;
    `);
  }
}
