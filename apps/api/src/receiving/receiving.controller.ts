import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import { QueryReceiptsDto } from './dto/receipt.dto';
import { ReceivingService } from './receiving.service';

@ApiTags('Receiving')
@Controller('receipts')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Get()
  @ApiOperation({ summary: 'List goods-in receipts' })
  list(@CurrentUser() user: RequestUser, @Query() query: QueryReceiptsDto) {
    return this.receiving.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Receipt detail with scanned IMEIs' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.receiving.findOne(user, id);
  }

  @Post(':id/validate')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a pending receipt, releasing its devices into stock' })
  validate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.receiving.validate(user, id);
  }
}
