import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { PosLookupDto, PosSaleDto } from './dto/pos.dto';
import { PosService } from './pos.service';

@ApiTags('POS')
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scan a handset at the counter',
    description: 'Says whether it can be sold here and what it sells for. Changes nothing.',
  })
  lookup(@CurrentUser() user: RequestUser, @Body() dto: PosLookupDto) {
    return this.pos.lookup(user, dto.imei, dto.warehouseId);
  }

  @Get('accessories')
  @ApiOperation({ summary: 'Accessories in stock at this till, with the price in force' })
  accessories(@CurrentUser() user: RequestUser, @Query('warehouseId') warehouseId?: string) {
    return this.pos.accessories(user, warehouseId);
  }

  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Sell over the counter',
    description:
      'Creates and completes the sale in one call. Two tills cannot sell the same handset: the loser is told to rescan and nothing is charged.',
  })
  sell(@CurrentUser() user: RequestUser, @Body() dto: PosSaleDto) {
    return this.pos.sell(user, dto);
  }

  @Get('today')
  @ApiOperation({ summary: 'Today’s counter takings for this shop' })
  today(@CurrentUser() user: RequestUser, @Query('warehouseId') warehouseId?: string) {
    return this.pos.today(user, warehouseId);
  }
}
