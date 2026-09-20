import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { QueryLedgerDto } from './dto/ledger.dto';
import { LedgersService } from './ledgers.service';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly ledgers: LedgersService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard figures',
    description:
      'Admins see every warehouse; a warehouse user always sees their own, whatever warehouseId they pass.',
  })
  dashboard(
    @CurrentUser() user: RequestUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.dashboard(user, warehouseId, from, to);
  }

  @Get('ledger/stock-value')
  @ApiOperation({
    summary: 'The products behind the stock value tile',
    description: 'Totals cover the whole filtered set, not the page, so they reconcile with the dashboard.',
  })
  stockValueLedger(@CurrentUser() user: RequestUser, @Query() query: QueryLedgerDto) {
    return this.ledgers.stockValue(user, query);
  }

  @Get('ledger/revenue')
  @ApiOperation({ summary: 'The sale lines behind the revenue tile' })
  revenueLedger(@CurrentUser() user: RequestUser, @Query() query: QueryLedgerDto) {
    return this.ledgers.revenue(user, query);
  }

  @Get('ledger/cost')
  @ApiOperation({ summary: 'The cost of the exact units sold, with the purchase each came in on' })
  costLedger(@CurrentUser() user: RequestUser, @Query() query: QueryLedgerDto) {
    return this.ledgers.cost(user, query);
  }

  @Get('ledger/profit')
  @ApiOperation({ summary: 'Revenue, cost, profit and margin per sale line' })
  profitLedger(@CurrentUser() user: RequestUser, @Query() query: QueryLedgerDto) {
    return this.ledgers.profit(user, query);
  }

  @Get('profit-by-product')
  @ApiOperation({ summary: 'Revenue, cost, profit and margin per product' })
  profitByProduct(@CurrentUser() user: RequestUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.profitByProduct(user, from, to);
  }
}
