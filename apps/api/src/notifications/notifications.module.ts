import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { ReminderService } from './reminder.service';

// Notification-Architektur: MailerService ist der einzige Versandkanal
// (SMTP). Weitere Kanäle (Web Push, SMS) docken später als zusätzliche
// Channel-Implementierungen hinter derselben Schnittstelle an.
// ReminderService plant und verschickt Erinnerungen über BullMQ.
@Global()
@Module({
  providers: [MailerService, ReminderService],
  exports: [MailerService, ReminderService],
})
export class NotificationsModule {}
