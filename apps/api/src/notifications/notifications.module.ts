import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

// Wird in Modul 8 um Reminder-Jobs (BullMQ) und die
// NotificationChannel-Abstraktion erweitert.
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class NotificationsModule {}
