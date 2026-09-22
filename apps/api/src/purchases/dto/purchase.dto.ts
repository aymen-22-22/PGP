import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, PurchaseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
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
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class PurchaseItemInputDto {
  @ApiProperty() @IsUUID() productId!: string;

  @ApiProperty({ example: 1000, minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @ApiProperty({ example: '900.00' }) @IsNumberString() unitPrice!: string;
}

export class CreatePurchaseDto {
  @ApiProperty() @IsUUID() supplierId!: string;

  @ApiProperty({ description: 'Receiving warehouse' }) @IsUUID() warehouseId!: string;

  @ApiPropertyOptional({ description: 'Defaults to today' }) @IsOptional() @IsISO8601() purchaseDate?: string;

  @ApiProperty({ enum: Currency, default: Currency.EUR })
  @IsOptional()
  @IsEnum(Currency)
  currency: Currency = Currency.EUR;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiProperty({ type: [PurchaseItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items!: PurchaseItemInputDto[];
}

/**
 * One received line. A phone line carries `imeis`, an accessory line carries
 * `quantity` — exactly one, matching how the product is tracked.
 */
export class ReceiveLineDto {
  @ApiProperty({ description: 'The purchase line being received' })
  @IsUUID()
  purchaseItemId!: string;

  @ApiPropertyOptional({ type: [String], example: ['356789012345670'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  imeis?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['2UKBB25506101197'],
    description:
      'Serial numbers scanned instead of IMEIs. Each becomes a unit awaiting its IMEI (status PENDING_IDENTIFICATION), identified later via *#06#.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  serials?: string[];

  @ApiPropertyOptional({ description: 'Units received, for accessories tracked by quantity', example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;
}

export class ReceivePurchaseDto {
  @ApiProperty({ type: [ReceiveLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];

  @ApiPropertyOptional({
    default: false,
    description: 'Accept fewer IMEIs than ordered. Requires ALLOW_PARTIAL_RECEIPT.',
  })
  @IsOptional()
  allowPartial?: boolean;
}

export class ReceiveByLabelDto {
  @ApiProperty({ example: 'UL-2026-000123', description: 'The code scanned off the printed label' })
  @IsString()
  @MaxLength(40)
  code!: string;
}

export class PrintLabelsDto {
  @ApiPropertyOptional({ description: 'Only these label ids; omit to print every label on the purchase' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  labelIds?: string[];
}

export class QueryPurchasesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PurchaseStatus })
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
