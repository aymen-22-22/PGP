import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateUserDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(200) password!: string;

  @ApiProperty({ enum: Role }) @IsEnum(Role) role!: Role;

  @ApiPropertyOptional({ description: 'Required for WAREHOUSE_USER' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyByEmail?: boolean;
}

/** What a person may change about themselves, without being an administrator. */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({ description: 'Receive the operational emails' })
  @IsOptional()
  @IsBoolean()
  notifyByEmail?: boolean;
}

export class QueryUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role }) @IsOptional() @IsEnum(Role) role?: Role;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isActive?: boolean;
}
