import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { LedgersService } from './ledgers.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, LedgersService],
})
export class ReportsModule {}
