import { Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { env } from '../common/config/env';
import { PrismaService } from '../prisma/prisma.service';

// iCal-Feed (RFC 5545) der eigenen Dienste. Bewusst ohne iCal-Lib:
// das benötigte Subset ist ~30 Zeilen, eine Dependency weniger.
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async status(personId: string) {
    const token = await this.prisma.calendarFeedToken.findUnique({ where: { personId } });
    return { exists: token !== null, rotatedAt: token?.rotatedAt ?? null };
  }

  async rotateToken(personId: string): Promise<{ url: string }> {
    const token = generateToken();
    await this.prisma.calendarFeedToken.upsert({
      where: { personId },
      create: { personId, tokenHash: hashToken(token) },
      update: { tokenHash: hashToken(token), rotatedAt: new Date() },
    });
    return { url: `${env.APP_URL}/api/v1/ical/${token}.ics` };
  }

  async buildFeed(token: string): Promise<string | null> {
    const record = await this.prisma.calendarFeedToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record) return null;

    // Letzte 30 Tage + Zukunft: Kalender-Apps mögen etwas Historie
    const assignments = await this.prisma.assignment.findMany({
      where: {
        personId: record.personId,
        status: { in: ['REQUESTED', 'ACCEPTED'] },
        slot: {
          event: {
            status: 'PUBLISHED',
            startsAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
          },
        },
      },
      include: { slot: { include: { event: true, position: true } } },
      orderBy: { slot: { event: { startsAt: 'asc' } } },
    });

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ServeFlow//DE',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:ServeFlow Dienste',
    ];
    for (const assignment of assignments) {
      const event = assignment.slot.event;
      lines.push(
        'BEGIN:VEVENT',
        `UID:serveflow-${assignment.id}`,
        `DTSTAMP:${formatUtc(new Date())}`,
        `DTSTART:${formatUtc(event.startsAt)}`,
        `DTEND:${formatUtc(event.endsAt)}`,
        `SUMMARY:${escapeIcs(`${assignment.slot.position.name} – ${event.title}`)}`,
        ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
        // REQUESTED erscheint als "vorläufig" im Kalender
        `STATUS:${assignment.status === 'ACCEPTED' ? 'CONFIRMED' : 'TENTATIVE'}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    // RFC 5545 verlangt CRLF-Zeilenenden
    return lines.join('\r\n') + '\r\n';
  }
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// Kommas, Semikolons und Zeilenumbrüche müssen in iCal escaped werden
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[,;]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');
}
