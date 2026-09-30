import { Module } from '@nestjs/common';
import { PurchasesModule } from '../purchases/purchases.module';
import { TransfersModule } from '../transfers/transfers.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [PurchasesModule, TransfersModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
