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
    // RFC 5545 verlangt CRLF-Zeilenenden und Faltung ab 75 Oktett
    return lines.map(foldIcsLine).join('\r\n') + '\r\n';
  }
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// Kommas, Semikolons und Zeilenumbrüche müssen in iCal escaped werden.
//
// Wichtig: Auch ein EINZELNES \r muss entfernt werden. Zeilen eines
// iCal-Dokuments werden per CRLF getrennt; ein rohes CR mitten in einem
// Wert lassen viele Parser trotzdem als Zeilenende durchgehen. Ein
// Terminort wie "Saal\rX-EVIL:1" erzeugte dadurch eine eigenständige
// iCal-Property im Kalender aller Eingeteilten. Ebenso werden übrige
// Steuerzeichen verworfen – RFC 5545 lässt sie in Textwerten nicht zu.
function escapeIcs(value: string): string {
  return (
    value
      .replace(/\r\n?/g, '\n') // CR und CRLF auf LF normalisieren
      // Übrige Steuerzeichen entfernen. Bewusst per Code-Point-Prüfung statt
      // per Regex-Zeichenklasse: Steuerzeichen in einem regulären Ausdruck
      // sind unlesbar, und ESLint verbietet sie zu Recht (no-control-regex).
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return char === '\n' || (code >= 0x20 && code !== 0x7f);
      })
      .join('')
      .replace(/\\/g, '\\\\')
      .replace(/[,;]/g, (c) => `\\${c}`)
      .replace(/\n/g, '\\n')
  );
}

// RFC 5545 begrenzt Zeilen auf 75 Oktett; längere Zeilen werden gefaltet
// (Umbruch + führendes Leerzeichen). Ohne Faltung lehnen strenge Parser
// das Dokument ab oder schneiden Werte ab. Gezählt wird in Bytes, nicht in
// Zeichen – Umlaute belegen in UTF-8 mehrere Oktett.
function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  // Erste Zeile 75 Oktett, Folgezeilen 74 (das führende Leerzeichen zählt mit).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Nicht mitten in einem UTF-8-Zeichen trennen: Fortsetzungsbytes
    // beginnen mit 0b10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return parts.join('\r\n ');
}
