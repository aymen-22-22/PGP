import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { CreateReturnDto, QueryReturnsDto } from './dto/return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Returns')
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'List returns' })
  list(@CurrentUser() user: RequestUser, @Query() query: QueryReturnsDto) {
    return this.returns.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Return detail' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Record a customer return of specific IMEIs' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReturnDto) {
    return this.returns.create(user, dto);
  }
}
