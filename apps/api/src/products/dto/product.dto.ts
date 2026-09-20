import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Currency, TrackingMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateProductDto {
  @ApiProperty({ example: 'iPhone 18 Pro Max 256GB Black' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'APL-IP18PM-256-BLK' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  sku!: string;

  @ApiProperty({ description: 'The make. Create one first if it is not in the list.' })
  @IsUUID()
  brandId!: string;
  @ApiProperty({ example: 'iPhone 18 Pro Max' }) @IsString() @MaxLength(120) model!: string;

  @ApiPropertyOptional({ example: '256GB' }) @IsOptional() @IsString() @MaxLength(40) storage?: string;
  @ApiPropertyOptional({ example: 'Black' }) @IsOptional() @IsString() @MaxLength(40) color?: string;
  @ApiPropertyOptional({ example: 'Smartphone' }) @IsOptional() @IsString() @MaxLength(60) category?: string;

  @ApiProperty({ example: '900.00', description: 'Decimal string' })
  @IsNumberString({ no_symbols: false })
  purchasePrice!: string;

  @ApiProperty({ example: '980.00', description: 'Decimal string' })
  @IsNumberString({ no_symbols: false })
  defaultSalePrice!: string;

  @ApiPropertyOptional({
    example: '5901234123457',
    description: 'The EAN-13 on the box. Identifies the product, never a unit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  barcode?: string;

  // No initialiser here on purpose. UpdateProductDto extends this class, and a
  // property default is inherited along with everything else — an edit that
  // never mentions the currency would arrive carrying EUR and quietly reset a
  // product priced in dinars. The column's own default covers creation.
  @ApiPropertyOptional({ enum: Currency, default: Currency.EUR })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  // Likewise no initialiser: an inherited SERIALIZED default made every edit
  // of an accessory look like a request to change how it is counted, which the
  // service refuses once the product holds stock.
  @ApiPropertyOptional({
    enum: TrackingMode,
    default: TrackingMode.SERIALIZED,
    description:
      'SERIALIZED for phones (every unit scanned by IMEI); BULK for accessories counted by quantity.',
  })
  @IsOptional()
  @IsEnum(TrackingMode)
  tracking?: TrackingMode;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class QueryProductsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by brand name' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @ApiPropertyOptional({ description: 'Filter by brand id' })
  @IsOptional()
  @IsUUID()
  brandId?: string;
  @ApiPropertyOptional({ enum: TrackingMode })
  @IsOptional()
  @IsEnum(TrackingMode)
  tracking?: TrackingMode;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isActive?: boolean;
}
