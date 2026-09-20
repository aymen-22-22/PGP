import { Module } from '@nestjs/common';
import { CostingController } from './costing.controller';
import { CostingService } from './costing.service';
import { ExchangeRateService } from './exchange-rate.service';
import { LandedCostStatementService } from './landed-cost-statement.service';

@Module({
  controllers: [CostingController],
  providers: [CostingService, ExchangeRateService, LandedCostStatementService],
  exports: [CostingService, ExchangeRateService, LandedCostStatementService],
})
export class CostingModule {}
