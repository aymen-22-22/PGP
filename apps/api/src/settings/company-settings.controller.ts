import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import { SettingsService } from './settings.service';

export interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  /** Printed at the bottom of every invoice: bank details, warranty terms… */
  footer: string;
}

const EMPTY: CompanySettings = { name: '', address: '', phone: '', email: '', taxId: '', footer: '' };

class CompanyDto implements CompanySettings {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(400) address = '';
  @IsOptional() @IsString() @MaxLength(60) phone = '';
  @IsOptional() @IsString() @MaxLength(120) email = '';
  @IsOptional() @IsString() @MaxLength(120) taxId = '';
  @IsOptional() @IsString() @MaxLength(1000) footer = '';
}

/** Who the invoices come from: set once by the admin, printed on every invoice. */
@ApiTags('Settings')
@Controller('settings/company')
export class CompanySettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'The business details printed on invoices' })
  async read(): Promise<CompanySettings> {
    return { ...EMPTY, ...((await this.settings.get<CompanySettings>('company')) ?? {}) };
  }

  @Put()
  @AdminOnly()
  @ApiOperation({ summary: 'Change the business details printed on invoices' })
  async save(@Body() dto: CompanyDto, @CurrentUser() user: RequestUser): Promise<CompanySettings> {
    const value: CompanySettings = {
      name: dto.name.trim(),
      address: dto.address.trim(),
      phone: dto.phone.trim(),
      email: dto.email.trim(),
      taxId: dto.taxId.trim(),
      footer: dto.footer.trim(),
    };
    await this.settings.set('company', value, user.id);
    return value;
  }
}
