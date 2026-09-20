import { Module } from '@nestjs/common';
import { StockExplorerController } from './stock-explorer.controller';
import { StockExplorerService } from './stock-explorer.service';

@Module({
  controllers: [StockExplorerController],
  providers: [StockExplorerService],
})
export class StockExplorerModule {}
