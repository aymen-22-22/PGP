import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, PaymentMethod, SaleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class SaleItemInputDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ minimum: 1, maximum: 100000 }) @IsInt() @Min(1) @Max(100000) quantity!: number;

  @ApiPropertyOptional({ description: 'Defaults to the product’s list price' })
  @IsOptional()
  @IsNumberString()
  unitPrice?: string;
}

export class SalePaymentDto {
  @ApiProperty({ example: '250.00', description: 'Amount received, in the sale currency' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ description: 'When it was paid; defaults to now' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateSaleDto {
  @ApiProperty() @IsUUID() customerId!: string;

  @ApiPropertyOptional({ description: 'Selling warehouse; ignored for warehouse users' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ enum: Currency, default: Currency.EUR })
  @IsOptional()
  @IsEnum(Currency)
  currency: Currency = Currency.EUR;

  @ApiProperty({ type: [SaleItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items!: SaleItemInputDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiPropertyOptional({ type: () => SalePaymentDto, description: 'Money received when the order is taken' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SalePaymentDto)
  payment?: SalePaymentDto;
}

export class CompleteSaleDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'The exact IMEIs shipped. Omit to let the system pick the oldest matching stock.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  imeis?: string[];

  @ApiPropertyOptional({ default: false, description: 'Pick the oldest available devices automatically' })
  @IsOptional()
  @IsBoolean()
  autoPick?: boolean;
}

export class QuerySalesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SaleStatus }) @IsOptional() @IsEnum(SaleStatus) status?: SaleStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ enum: ['UNPAID', 'PARTIAL', 'PAID'] })
  @IsOptional()
  @IsIn(['UNPAID', 'PARTIAL', 'PAID'])
  payment?: 'UNPAID' | 'PARTIAL' | 'PAID';
}
