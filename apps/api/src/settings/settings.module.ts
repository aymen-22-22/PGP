import { Global, Module } from '@nestjs/common';
import { MailSettingsController } from './mail-settings.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({ controllers: [MailSettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
