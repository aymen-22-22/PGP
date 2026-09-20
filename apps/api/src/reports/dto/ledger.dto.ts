import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Everything a ledger needs to answer "where did this number come from".
 *
 * The scope fields are the same ones the dashboard takes, so a tile can hand
 * its own filters straight to the page that explains it.
 */
export class QueryLedgerDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Ignored for warehouse users, who always see their own' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) category?: string;

  @ApiPropertyOptional({ description: 'Column to order by' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';
}
