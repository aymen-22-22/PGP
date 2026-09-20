import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { AdjustStockDto, QueryStockDto } from './dto/stock.dto';
import { StockService } from './stock.service';

@ApiTags('Stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @ApiOperation({ summary: 'On-hand quantities of accessories, by warehouse' })
  levels(@CurrentUser() user: RequestUser, @Query() query: QueryStockDto) {
    return this.stock.levels(user, query);
  }

  @Post('adjust')
  @ApiOperation({ summary: 'Correct a counted quantity after a stock take' })
  adjust(@CurrentUser() user: RequestUser, @Body() dto: AdjustStockDto) {
    return this.stock.adjust(user, dto);
  }
}
