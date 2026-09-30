import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class OpsWarehouseQueryDto {
  @ApiPropertyOptional({ description: 'Admins pick the warehouse; a warehouse user always works in their own' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class OpsScanDto extends OpsWarehouseQueryDto {
  @ApiProperty({ example: 'UL-2026-000123' })
  @IsString()
  @MaxLength(100)
  code!: string;
}

export class OpsSendDto extends OpsWarehouseQueryDto {
  @ApiProperty({ type: [String], description: 'The codes scanned for this dispatch' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  codes!: string[];

  @ApiProperty()
  @IsUUID()
  destinationWarehouseId!: string;
}
