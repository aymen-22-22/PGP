import { Global, Module } from '@nestjs/common';
import { CompanySettingsController } from './company-settings.controller';
import { MailSettingsController } from './mail-settings.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({
  controllers: [MailSettingsController, CompanySettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
