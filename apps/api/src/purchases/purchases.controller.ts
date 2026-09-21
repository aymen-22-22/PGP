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
import { CreatePurchaseDto, QueryPurchasesDto, ReceivePurchaseDto } from './dto/purchase.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('Purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @ApiOperation({ summary: 'List purchases visible to the current user' })
  list(@CurrentUser() user: RequestUser, @Query() query: QueryPurchasesDto) {
    return this.purchases.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Purchase detail with lines and receipts' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.findOne(user, id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Create a purchase order' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePurchaseDto) {
    return this.purchases.create(user, dto);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive scanned IMEIs into the purchase warehouse',
    description:
      'Transactional: every device is created or none is. Warehouse users may only receive into their own warehouse.',
  })
  receive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceivePurchaseDto,
  ) {
    return this.purchases.receive(user, id, dto);
  }

  @Post(':id/labels')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reserve a label code for every unit on this purchase',
    description:
      'Idempotent: only units without a label get one, so pressing the button twice is harmless.',
  })
  generateLabels(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.generateLabels(user, id);
  }

  @Get(':id/labels')
  @ApiOperation({ summary: 'The labels on this purchase, in printing order' })
  labels(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.labels(user, id);
  }

  @Post(':id/cancel')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a purchase that has not been received' })
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.cancel(user, id);
  }
}
