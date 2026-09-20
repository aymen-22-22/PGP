import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { CreatePartyDto, QueryPartyDto, UpdatePartyDto } from '../common/dto/party.dto';
import type { RequestUser } from '../common/types';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers' })
  list(@Query() query: QueryPartyDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one customer' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Create a customer' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePartyDto) {
    return this.customers.create(user, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Update a customer' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePartyDto) {
    return this.customers.update(id, dto);
  }
}
