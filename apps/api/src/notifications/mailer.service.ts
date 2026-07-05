import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { env } from '../common/config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

// Dünne SMTP-Abstraktion. Bewusst als eigener Service statt direktem
// nodemailer-Aufruf in Features: Modul 8 hängt hier die
// NotificationChannel-Abstraktion (Push/SMS später) und die BullMQ-Queue
// davor, ohne dass Aufrufer sich ändern müssen.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;

  constructor() {
    this.transporter =
      env.NODE_ENV === 'test'
        ? // In Tests keine echten Verbindungen: jsonTransport rendert die
          // Mail nur, Assertions können sie über sentMail-Spies prüfen
          createTransport({ jsonTransport: true })
        : createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
          });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({ from: env.SMTP_FROM, ...message });
    } catch (error) {
      // Mail-Fehler dürfen fachliche Requests nicht abbrechen (z. B. Login
      // trotz kaputtem SMTP). Verlorene Mails sind im Log sichtbar.
      this.logger.error(`Mailversand an ${message.to} fehlgeschlagen: ${String(error)}`);
    }
  }
}
