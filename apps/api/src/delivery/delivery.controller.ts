import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import { DeliveryService } from './delivery.service';
import {
  CreateDeliveryCompanyDto,
  CreateDriverDto,
  QueryCarrierShipmentsDto,
  QueryDeliveryDto,
  UpdateDeliveryCompanyDto,
  UpdateDriverDto,
} from './dto/delivery.dto';

/**
 * Reading is open, writing is not: a picker has to pick a carrier off a
 * shipment, but managing who the business works with is office work.
 */
@ApiTags('Delivery')
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('companies')
  @ApiOperation({ summary: 'Transport firms — active only unless asked otherwise' })
  listCompanies(@Query() query: QueryDeliveryDto) {
    return this.delivery.listCompanies(query);
  }

  @Post('companies')
  @AdminOnly()
  @ApiOperation({ summary: 'Add a transport firm' })
  createCompany(@CurrentUser() user: RequestUser, @Body() dto: CreateDeliveryCompanyDto) {
    return this.delivery.createCompany(user, dto);
  }

  @Patch('companies/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Edit or retire a transport firm' })
  updateCompany(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryCompanyDto,
  ) {
    return this.delivery.updateCompany(user, id, dto);
  }

  @Delete('companies/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Delete a firm that has never carried anything' })
  removeCompany(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.removeCompany(user, id);
  }

  @Get('companies/:id/shipments')
  @AdminOnly()
  @ApiOperation({ summary: 'Everything this transport firm has carried, filterable by status' })
  companyShipments(@Param('id', ParseUUIDPipe) id: string, @Query() query: QueryCarrierShipmentsDto) {
    return this.delivery.companyShipments(id, query);
  }

  @Get('drivers')
  @ApiOperation({ summary: 'Drivers — active only unless asked otherwise' })
  listDrivers(@Query() query: QueryDeliveryDto) {
    return this.delivery.listDrivers(query);
  }

  @Post('drivers')
  @AdminOnly()
  @ApiOperation({ summary: 'Add a driver' })
  createDriver(@CurrentUser() user: RequestUser, @Body() dto: CreateDriverDto) {
    return this.delivery.createDriver(user, dto);
  }

  @Patch('drivers/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Edit or retire a driver' })
  updateDriver(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.delivery.updateDriver(user, id, dto);
  }

  @Delete('drivers/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Delete a driver who has never carried anything' })
  removeDriver(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.removeDriver(user, id);
  }

  @Get('drivers/:id/shipments')
  @AdminOnly()
  @ApiOperation({ summary: 'Everything this driver has carried, filterable by status' })
  driverShipments(@Param('id', ParseUUIDPipe) id: string, @Query() query: QueryCarrierShipmentsDto) {
    return this.delivery.driverShipments(id, query);
  }
}
