import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { OpsScanDto, OpsSendDto, OpsWarehouseQueryDto } from './ops.dto';
import { OpsService } from './ops.service';

/** The warehouse floor in four calls: what is coming, what is this, receive it, send it. */
@ApiTags('Warehouse operations')
@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('incoming')
  @ApiOperation({ summary: 'Products on their way to the warehouse, per product' })
  incoming(@CurrentUser() user: RequestUser, @Query() q: OpsWarehouseQueryDto) {
    return this.ops.incoming(user, q.warehouseId);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Recent receptions and shipments in the warehouse, one line per step' })
  activity(@CurrentUser() user: RequestUser, @Query() q: OpsWarehouseQueryDto) {
    return this.ops.activity(user, q.warehouseId);
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'What a scanned code is here, and what can be done' })
  scan(@CurrentUser() user: RequestUser, @Body() dto: OpsScanDto) {
    return this.ops.scan(user, dto.code, dto.warehouseId);
  }

  @Post('receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive the scanned unit (from a purchase or a transfer)' })
  receive(@CurrentUser() user: RequestUser, @Body() dto: OpsScanDto) {
    return this.ops.receive(user, dto.code, dto.warehouseId);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send the scanned units to another warehouse (creates and ships a transfer)' })
  send(@CurrentUser() user: RequestUser, @Body() dto: OpsSendDto) {
    return this.ops.send(user, dto.codes, dto.destinationWarehouseId, dto.warehouseId);
  }
}
