import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ReturnLineDto {
  @ApiProperty({ example: '356789012345670' }) @IsString() imei!: string;

  @ApiPropertyOptional({
    enum: ReturnStatus,
    default: ReturnStatus.RESTOCKED,
    description: 'RESTOCKED puts the phone back into sellable stock; DAMAGED does not.',
  })
  @IsOptional()
  @IsEnum(ReturnStatus)
  outcome?: ReturnStatus;
}

export class CreateReturnDto {
  @ApiProperty() @IsUUID() customerId!: string;

  @ApiPropertyOptional({ description: 'Receiving warehouse; ignored for warehouse users' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) reason?: string;

  @ApiProperty({ type: [ReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

export class QueryReturnsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
