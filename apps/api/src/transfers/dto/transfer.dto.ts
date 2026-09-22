import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class TransferItemInputDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ minimum: 1, maximum: 100000 }) @IsInt() @Min(1) @Max(100000) quantity!: number;
}

export class CreateTransferDto {
  @ApiProperty() @IsUUID() sourceWarehouseId!: string;
  @ApiProperty() @IsUUID() destinationWarehouseId!: string;

  @ApiProperty({ type: [TransferItemInputDto], description: 'Planned quantity per product' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TransferItemInputDto)
  items!: TransferItemInputDto[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Optionally load these exact IMEIs immediately',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  imeis?: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Fill the transfer automatically with the oldest matching devices in the source warehouse',
  })
  @IsOptional()
  @IsBoolean()
  autoFill?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiPropertyOptional({ description: 'Who is carrying it — a managed transport firm' })
  @IsOptional()
  @IsUUID()
  deliveryCompanyId?: string;
  @ApiPropertyOptional({ description: 'Who is at the wheel' })
  @IsOptional()
  @IsUUID()
  driverId?: string;
}

export class LoadDevicesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  imeis!: string[];
}

export class ShipTransferDto {
  /** Free text, for a one-off courier nobody wants a record for. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) carrier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) trackingRef?: string;
  @ApiPropertyOptional({ description: 'A managed transport firm' })
  @IsOptional()
  @IsUUID()
  deliveryCompanyId?: string;
  @ApiPropertyOptional({ description: 'Who is at the wheel' })
  @IsOptional()
  @IsUUID()
  driverId?: string;
}

export class ReceiveTransferDto {
  /** Empty on a transfer carrying only accessories, which have nothing to scan. */
  @ApiPropertyOptional({ type: [String], description: 'IMEIs physically scanned at the destination' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  imeis?: string[];

  @ApiPropertyOptional({ default: false, description: 'Close the transfer even if some devices are missing' })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;
}

export class QueryTransfersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransferStatus })
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ description: 'Only transfers arriving at the given/own warehouse' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  incoming?: boolean;
  @ApiPropertyOptional({ description: 'Only transfers sent from the given/own warehouse' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  outgoing?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
