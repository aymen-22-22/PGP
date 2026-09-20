import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { QueryInventoryDto, QueryStockDevicesDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'Stock per warehouse and product, derived from device records' })
  summary(@CurrentUser() user: RequestUser, @Query() query: QueryInventoryDto) {
    return this.inventory.summary(user, query);
  }

  @Get('devices')
  @ApiOperation({ summary: 'The individual phones behind a stock figure' })
  devices(@CurrentUser() user: RequestUser, @Query() query: QueryStockDevicesDto) {
    return this.inventory.devices(user, query);
  }

  @Get(':warehouseId')
  @ApiOperation({ summary: 'Headline stock counts for one warehouse' })
  forWarehouse(@CurrentUser() user: RequestUser, @Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.inventory.forWarehouse(user, warehouseId);
  }
}
