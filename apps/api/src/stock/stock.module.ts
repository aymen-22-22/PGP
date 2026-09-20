import { Global, Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/**
 * Global because purchases, transfers, sales and the till all move quantities,
 * and re-importing this in each of them buys nothing.
 */
@Global()
@Module({ controllers: [StockController], providers: [StockService], exports: [StockService] })
export class StockModule {}
