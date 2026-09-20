import {
  Body,
  Controller,
  Delete,
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
import type { RequestUser } from '../common/types';
import {
  CreateTransferDto,
  LoadDevicesDto,
  QueryTransfersDto,
  ReceiveTransferDto,
  ShipTransferDto,
} from './dto/transfer.dto';
import { TransfersService } from './transfers.service';

@ApiTags('Transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @ApiOperation({ summary: 'List transfers involving the user’s warehouse' })
  list(@CurrentUser() user: RequestUser, @Query() query: QueryTransfersDto) {
    return this.transfers.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Transfer detail with its loaded devices' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a transfer from the user’s warehouse' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransferDto) {
    return this.transfers.create(user, dto);
  }

  @Post(':id/load')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Load specific scanned IMEIs onto the transfer' })
  load(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoadDevicesDto,
  ) {
    return this.transfers.loadDevices(user, id, dto);
  }

  @Post(':id/auto-fill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fill the transfer with the oldest matching available devices' })
  autoFill(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.autoFill(user, id);
  }

  @Delete(':id/devices/:imei')
  @ApiOperation({ summary: 'Remove one device from a transfer that has not shipped' })
  unload(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imei') imei: string,
  ) {
    return this.transfers.unloadDevice(user, id, imei);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch the transfer — source warehouse only' })
  ship(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipTransferDto,
  ) {
    return this.transfers.ship(user, id, dto);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive scanned IMEIs — destination warehouse only' })
  receive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferDto,
  ) {
    return this.transfers.receive(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a transfer that has not been shipped' })
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.cancel(user, id);
  }
}
