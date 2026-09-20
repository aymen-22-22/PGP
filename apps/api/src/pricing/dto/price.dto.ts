import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { IsEnum, IsISO8601, IsNumberString, IsOptional, IsUUID } from 'class-validator';

export class SetPriceDto {
  @ApiProperty({ example: '1200.00' }) @IsNumberString() price!: string;

  @ApiProperty({ enum: Currency, description: 'Sell in the currency the market actually pays in.' })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiPropertyOptional({ description: 'Leave empty for one price in every country' })
  @IsOptional()
  @IsUUID()
  countryId?: string;

  @ApiPropertyOptional({ description: 'Defaults to now. A future date schedules the change.' })
  @IsOptional()
  @IsISO8601()
  validFrom?: string;
}
