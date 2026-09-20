import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosLineDto {
  @ApiProperty({ example: '990000000000010' }) @IsString() imei!: string;

  @ApiPropertyOptional({ description: 'Overrides the price list for this unit only' })
  @IsOptional()
  @IsNumberString()
  unitPrice?: string;
}

/** An accessory at the till: no IMEI to scan, just how many. */
export class PosItemDto {
  @ApiProperty() @IsUUID() productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Overrides the price list for this line only' })
  @IsOptional()
  @IsNumberString()
  unitPrice?: string;
}

export class PosSaleDto {
  @ApiPropertyOptional({ type: [PosLineDto], description: 'The handsets going over the counter' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PosLineDto)
  lines?: PosLineDto[];

  @ApiPropertyOptional({ type: [PosItemDto], description: 'Accessories, sold by quantity' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PosItemDto)
  items?: PosItemDto[];

  @ApiPropertyOptional({ description: 'Walk-in sales may leave this empty' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: Currency, description: 'Defaults to the warehouse country’s currency' })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ description: 'Ignored for warehouse users, who sell from their own shop' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class PosLookupDto {
  @ApiProperty() @IsString() imei!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
