import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AllocationMethod, CostScope, CostType, Currency } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ManualAmountDto {
  @ApiProperty() @IsUUID() deviceId!: string;
  @ApiProperty({ example: '12.50' }) @IsNumberString() amount!: string;
}

export class CreateCostDocumentDto {
  @ApiProperty({ enum: CostType, example: CostType.FREIGHT })
  @IsEnum(CostType)
  type!: CostType;

  @ApiPropertyOptional({ example: 'DHL invoice 88231, Lyon → Barcelona' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ example: '1250.00', description: 'As billed, in `currency`' })
  @IsNumberString()
  amount!: string;

  @ApiProperty({
    enum: Currency,
    description: 'Bill it in the currency you were charged. DZD is converted to EUR on posting.',
  })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiPropertyOptional({ description: 'Defaults to today. Sets the exchange rate that is used.' })
  @IsOptional()
  @IsISO8601()
  incurredAt?: string;

  @ApiProperty({ enum: AllocationMethod, default: AllocationMethod.QUANTITY })
  @IsOptional()
  @IsEnum(AllocationMethod)
  allocation: AllocationMethod = AllocationMethod.QUANTITY;

  @ApiProperty({
    enum: CostScope,
    description: 'What the bill covers: a goods-in receipt, a shipment leg, a whole lot, or a chosen list.',
  })
  @IsEnum(CostScope)
  scope!: CostScope;

  @ApiPropertyOptional({ description: 'Receipt, shipment/transfer or lot id, per `scope`' })
  @IsOptional()
  @IsUUID()
  scopeId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Required when scope is DEVICES' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  deviceIds?: string[];

  @ApiPropertyOptional({ type: [ManualAmountDto], description: 'Required when allocation is MANUAL' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ManualAmountDto)
  manualAmounts?: ManualAmountDto[];

  @ApiPropertyOptional({ default: true, description: 'Post immediately. Set false to keep it as a draft.' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class PostCostDocumentDto {
  @ApiPropertyOptional({ type: [ManualAmountDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ManualAmountDto)
  manualAmounts?: ManualAmountDto[];
}

export class QueryCostDocumentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CostType }) @IsOptional() @IsEnum(CostType) type?: CostType;
  @ApiPropertyOptional({ enum: CostScope }) @IsOptional() @IsEnum(CostScope) scope?: CostScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() lotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

export class CreateExchangeRateDto {
  @ApiProperty({ enum: Currency }) @IsEnum(Currency) fromCurrency!: Currency;
  @ApiProperty({ enum: Currency }) @IsEnum(Currency) toCurrency!: Currency;
  @ApiProperty({ example: '0.00357142', description: 'Units of toCurrency per one fromCurrency' })
  @IsNumberString()
  rate!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() validFrom?: string;
}
