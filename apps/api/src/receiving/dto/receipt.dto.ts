import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReceiptSource, ReceiptStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class QueryReceiptsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReceiptStatus }) @IsOptional() @IsEnum(ReceiptStatus) status?: ReceiptStatus;
  @ApiPropertyOptional({ enum: ReceiptSource }) @IsOptional() @IsEnum(ReceiptSource) source?: ReceiptSource;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
