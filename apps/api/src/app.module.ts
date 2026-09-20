import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import compression from 'compression';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CostingModule } from './costing/costing.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { APP_CONFIG } from './common/tokens';
import { loadConfiguration } from './config/configuration';
import { CustomersModule } from './customers/customers.module';
import { ImeisModule } from './imeis/imeis.module';
import { InventoryModule } from './inventory/inventory.module';
import { PosModule } from './pos/pos.module';
import { PricingModule } from './pricing/pricing.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StockExplorerModule } from './stock-explorer/stock-explorer.module';
import { StockModule } from './stock/stock.module';
import { BrandsModule } from './brands/brands.module';
import { ProductsModule } from './products/products.module';
import { PurchasesModule } from './purchases/purchases.module';
import { ReceivingModule } from './receiving/receiving.module';
import { ReportsModule } from './reports/reports.module';
import { ReturnsModule } from './returns/returns.module';
import { SalesModule } from './sales/sales.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    // In-memory rate limiting — no Redis, as required by the hosting target.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const { throttle } = loadConfiguration();
        return [
          { name: 'default', ttl: throttle.ttlMs, limit: throttle.limit },
          { name: 'login', ttl: throttle.ttlMs, limit: throttle.loginLimit },
        ];
      },
    }),
    PrismaModule,
    RealtimeModule,
    CommonModule,
    AuditModule,
    AuthModule,
    UsersModule,
    WarehousesModule,
    BrandsModule,
    ProductsModule,
    StockModule,
    NotificationsModule,
    StockExplorerModule,
    SuppliersModule,
    CustomersModule,
    PurchasesModule,
    ReceivingModule,
    CostingModule,
    PricingModule,
    PosModule,
    TransfersModule,
    SalesModule,
    ReturnsModule,
    InventoryModule,
    ImeisModule,
    ReportsModule,
  ],
  providers: [
    // Order matters: authenticate, then check CSRF, then role, then rate limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    {
      provide: APP_GUARD,
      useFactory: (config: AppConfig, reflector: Reflector) => new CsrfGuard(config, reflector),
      inject: [APP_CONFIG, Reflector],
    },
    { provide: APP_GUARD, useFactory: (r: Reflector) => new RolesGuard(r), inject: [Reflector] },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: false },
        }),
    },
    {
      provide: APP_FILTER,
      useFactory: () => new AllExceptionsFilter(loadConfiguration().nodeEnv === 'production'),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(compression()).forRoutes('*');
  }
}
