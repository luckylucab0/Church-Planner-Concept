import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConnectionOptions, Queue, Worker } from 'bullmq';
import { interpolate, Locale, messages } from '@serveflow/shared';
import { MailerService } from './mailer.service';
import { env } from '../common/config/env';
import { PrismaService } from '../prisma/prisma.service';

// Automatische Erinnerungen vor dem Dienst (konfigurierbar über
// REMINDER_DAYS_BEFORE, Default 7 und 1 Tag vorher).
//
// Mechanik: Ein BullMQ-Repeat-Job ruft alle 15 Minuten scanAndSend()
// auf. Statt pro Erinnerung einen Job zu planen (der bei Terminänderung
// verwaist), wird bei jedem Lauf gezählt: Wie viele Schwellen sind für
// diese Einteilung schon unterschritten vs. wie viele Erinnerungen
// wurden laut NotificationLog schon verschickt? Fehlt eine, wird genau
// eine nachgeholt. Das ist idempotent und heilt verpasste Läufe
// (Server-Neustart, Downtime) von selbst.
@Injectable()
export class ReminderService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReminderService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async onModuleInit(): Promise<void> {
    // In Tests keinen Scheduler starten – Tests rufen scanAndSend() direkt
    if (env.NODE_ENV === 'test') return;

    // BullMQ verwaltet eigene Verbindungen (blockierende Kommandos);
    // maxRetriesPerRequest: null laut BullMQ-Doku
    const redisUrl = new URL(env.REDIS_URL);
    const connection: ConnectionOptions = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      password: redisUrl.password || undefined,
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue('reminders', { connection });
    this.worker = new Worker('reminders', async () => this.scanAndSend(), { connection });
    this.worker.on('failed', (_job, error) =>
      this.logger.error(`Reminder-Lauf fehlgeschlagen: ${String(error)}`),
    );
    await this.queue.upsertJobScheduler('reminder-scan', { every: 15 * 60 * 1000 });
    this.logger.log(`Erinnerungen aktiv: ${env.REMINDER_DAYS_BEFORE.join(', ')} Tage vorher`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  // Kern-Logik, direkt testbar. Liefert die Anzahl verschickter Mails.
  async scanAndSend(now: Date = new Date()): Promise<number> {
    const thresholds = env.REMINDER_DAYS_BEFORE;
    if (thresholds.length === 0) return 0;
    const maxDays = Math.max(...thresholds);

    const assignments = await this.prisma.assignment.findMany({
      where: {
        // Absagen nicht erinnern; REQUESTED schon (sanfter Stups zur Antwort)
        status: { in: ['REQUESTED', 'ACCEPTED'] },
        slot: {
          event: {
            status: 'PUBLISHED',
            startsAt: { gt: now, lte: new Date(now.getTime() + maxDays * 86_400_000) },
          },
        },
        person: { email: { not: null }, status: 'ACTIVE' },
      },
      include: {
        person: true,
        slot: { include: { event: true, position: true } },
        notifications: { where: { kind: 'REMINDER' }, select: { id: true } },
      },
    });

    let sent = 0;
    for (const assignment of assignments) {
      const eventStart = assignment.slot.event.startsAt;
      const daysUntil = (eventStart.getTime() - now.getTime()) / 86_400_000;
      // Wie viele Schwellen sind bereits erreicht (z. B. bei 6 Tagen: nur "7")
      const due = thresholds.filter((threshold) => daysUntil <= threshold).length;
      if (assignment.notifications.length >= due) continue;

      const texts = messages[(assignment.person.locale === 'en' ? 'en' : 'de') as Locale].mail;
      const vars = {
        firstName: assignment.person.firstName,
        eventTitle: assignment.slot.event.title,
        position: assignment.slot.position.name,
        date: eventStart.toLocaleString(assignment.person.locale === 'en' ? 'en-GB' : 'de-CH', {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      await this.mailer.send({
        to: assignment.person.email!,
        subject: interpolate(texts.reminderSubject, vars),
        text: interpolate(texts.reminderBody, vars),
      });
      await this.prisma.notificationLog.create({
        data: { personId: assignment.personId, assignmentId: assignment.id, kind: 'REMINDER' },
      });
      sent++;
    }
    return sent;
  }
}
