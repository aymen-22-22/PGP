import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { StockExplorerService } from './stock-explorer.service';

@ApiTags('Stock explorer')
@Controller('stock-explorer')
export class StockExplorerController {
  constructor(private readonly explorer: StockExplorerService) {}

  @Get('warehouses')
  @ApiOperation({
    summary: 'Warehouses this user may open, with their headline stock figures',
    description: 'A warehouse user sees only their own. The list is filtered here, not on the client.',
  })
  warehouses(@CurrentUser() user: RequestUser) {
    return this.explorer.warehouses(user);
  }

  @Get('warehouses/:warehouseId/categories')
  @ApiOperation({ summary: 'Categories actually holding stock in one warehouse' })
  categories(@CurrentUser() user: RequestUser, @Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.explorer.categories(user, warehouseId);
  }

  @Get('warehouses/:warehouseId/categories/:category/products')
  @ApiOperation({ summary: 'The products of one category, in one warehouse' })
  products(
    @CurrentUser() user: RequestUser,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('category') category: string,
  ) {
    return this.explorer.products(user, warehouseId, decodeURIComponent(category));
  }

  @Get('warehouses/:warehouseId/products/:productId')
  @ApiOperation({
    summary: 'Everything that has happened to one product in one warehouse',
    description: 'Stock by status, the units themselves, purchases, sales, and the full movement history.',
  })
  product360(
    @CurrentUser() user: RequestUser,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.explorer.product360(user, warehouseId, productId);
  }
}
