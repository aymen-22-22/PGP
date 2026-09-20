import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import { SetPriceDto } from './dto/price.dto';
import { PricingService } from './pricing.service';

@ApiTags('Pricing')
@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('price-list')
  @ApiOperation({
    summary: 'What every product sells for right now',
    description: 'Resolves country price, then a global price, then the product’s list price.',
  })
  currentList(@Query('countryId') countryId?: string) {
    return this.pricing.currentList(countryId);
  }

  @Get('products/:id/prices')
  @ApiOperation({ summary: 'Selling-price history for a product' })
  history(@Param('id', ParseUUIDPipe) id: string, @Query('countryId') countryId?: string) {
    return this.pricing.history(id, countryId);
  }

  @Get('products/:id/price')
  @ApiOperation({ summary: 'The price in force for a product, optionally in one country' })
  current(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('countryId') countryId?: string,
    @Query('at') at?: string,
  ) {
    return this.pricing.priceFor(id, countryId ?? null, at ? new Date(at) : new Date());
  }

  @Post('products/:id/prices')
  @AdminOnly()
  @ApiOperation({
    summary: 'Set a new selling price',
    description: 'Closes the price currently in force rather than overwriting it, so history survives.',
  })
  setPrice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriceDto,
  ) {
    return this.pricing.setPrice(user, id, dto);
  }
}
