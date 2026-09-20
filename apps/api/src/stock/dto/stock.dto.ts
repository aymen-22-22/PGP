import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class QueryStockDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
}

/**
 * Corrects a counted quantity to what is physically on the shelf.
 *
 * The figure is the new count, not a delta: a stock take produces "there are
 * 43", and making the counter work out that this is minus seven is how a
 * correction becomes a second error.
 */
export class AdjustStockDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;

  @ApiProperty({ example: 43, minimum: 0, description: 'The counted quantity now on the shelf' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @ApiProperty({
    description: 'Why the figure changed — required, because an unexplained adjustment is a loss',
  })
  @IsString()
  @MaxLength(300)
  reason!: string;
}
