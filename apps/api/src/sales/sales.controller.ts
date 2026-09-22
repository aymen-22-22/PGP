import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import { CompleteSaleDto, CreateSaleDto, QuerySalesDto } from './dto/sale.dto';
import { SalesService } from './sales.service';

// Selling — quoting, invoicing, cancelling — is an office function in this
// business, not a warehouse one. A warehouse account never needs to see what
// a unit sells for, only what it is and where it goes.
@ApiTags('Sales')
@Controller('sales')
@AdminOnly()
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @ApiOperation({ summary: 'List sales for the user’s warehouse' })
  list(@CurrentUser() user: RequestUser, @Query() query: QuerySalesDto) {
    return this.sales.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Sale detail with the exact devices shipped' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a sales order' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSaleDto) {
    return this.sales.create(user, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a sale against specific IMEIs',
    description: 'The same IMEI can never be sold twice: the losing request receives IMEI_NOT_AVAILABLE.',
  })
  complete(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSaleDto,
  ) {
    return this.sales.complete(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a sale that has not been completed' })
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.cancel(user, id);
  }
}
