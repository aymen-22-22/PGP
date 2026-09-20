import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CreatePartyDto, QueryPartyDto, UpdatePartyDto } from '../common/dto/party.dto';
import type { RequestUser } from '../common/types';
import { SuppliersService } from './suppliers.service';

@ApiTags('Suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'List suppliers' })
  list(@Query() query: QueryPartyDto) {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one supplier' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Create a supplier' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePartyDto) {
    return this.suppliers.create(user, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePartyDto) {
    return this.suppliers.update(id, dto);
  }
}
