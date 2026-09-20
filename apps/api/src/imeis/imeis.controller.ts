import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { DeviceStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types';
import { ImeisService } from './imeis.service';

export class VerifyScanDto {
  @ApiPropertyOptional({ description: 'A normalised IMEI (used when `payload` is absent)' })
  @IsOptional() @IsString() imei?: string;
  @ApiPropertyOptional({
    description: 'The raw barcode payload as scanned. When absent, `imei` is used.',
  })
  @IsOptional() @IsString() payload?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() transferId?: string;
  @ApiPropertyOptional({ enum: DeviceStatus })
  @IsOptional()
  @IsEnum(DeviceStatus)
  expectStatus?: DeviceStatus;
  @ApiPropertyOptional({
    description: 'While receiving stock: an unknown IMEI or serial is offered as a new unit.',
  })
  @IsOptional() @IsBoolean() receiving?: boolean;
}

export class IdentifyDeviceDto {
  @ApiProperty({ description: 'The IMEI read from *#06# or the box label' })
  @IsString() imei!: string;
  @ApiPropertyOptional({ description: 'Second IMEI for a dual-SIM handset' })
  @IsOptional() @IsString() imei2?: string;
}

@ApiTags('IMEI')
@Controller('imeis')
export class ImeisController {
  constructor(private readonly imeis: ImeisService) {}

  @Get('search')
  @ApiOperation({ summary: 'Type-ahead over IMEI, serial number and product' })
  search(@CurrentUser() user: RequestUser, @Query('q') q: string, @Query('limit') limit?: string) {
    return this.imeis.search(user, q, limit ? Number(limit) : undefined);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve one scanned barcode (IMEI / serial / EAN / other) against a context',
  })
  verify(@CurrentUser() user: RequestUser, @Body() dto: VerifyScanDto) {
    return this.imeis.verifyScan(user, dto.payload ?? dto.imei ?? '', {
      warehouseId: dto.warehouseId,
      transferId: dto.transferId,
      expectStatus: dto.expectStatus,
      receiving: dto.receiving,
    });
  }

  @Patch(':deviceId/identify')
  @ApiOperation({
    summary: "Attach the IMEI to a unit received by serial, making it sellable stock",
  })
  identify(@CurrentUser() user: RequestUser, @Param('deviceId') deviceId: string, @Body() dto: IdentifyDeviceDto) {
    return this.imeis.identify(user, deviceId, dto);
  }

  @Get(':imei')
  @ApiOperation({ summary: 'Where is this phone, and where did it come from' })
  findOne(@CurrentUser() user: RequestUser, @Param('imei') imei: string) {
    return this.imeis.findByImei(user, imei);
  }

  @Get(':imei/history')
  @ApiOperation({ summary: 'The full chronological journey of one phone' })
  history(@CurrentUser() user: RequestUser, @Param('imei') imei: string) {
    return this.imeis.history(user, imei);
  }
}