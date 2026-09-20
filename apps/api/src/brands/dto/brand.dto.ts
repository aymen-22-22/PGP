import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBrandDto {
  @ApiProperty({ example: 'Xiaomi' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  // Trimmed here, so "Apple " never becomes a second Apple.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class QueryBrandsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) search?: string;
  @ApiPropertyOptional({ description: 'Only brands that have products' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  inUse?: boolean;
}
