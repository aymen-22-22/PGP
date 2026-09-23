import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { SystemController } from './system.controller';

@Module({ controllers: [SystemController], providers: [AlertsService] })
export class SystemModule {}
