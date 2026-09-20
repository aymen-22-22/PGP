import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Global because goods-in, despatch and arrival all announce themselves, and
 * re-importing this in each of those modules buys nothing.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, MailerService],
  exports: [NotificationsService, MailerService],
})
export class NotificationsModule {}
