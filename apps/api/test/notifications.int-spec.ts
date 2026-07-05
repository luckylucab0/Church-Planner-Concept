// Tests für Erinnerungen (idempotenter Scan) und den iCal-Feed.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { MailMessage, MailerService } from '../src/notifications/mailer.service';
import { ReminderService } from '../src/notifications/reminder.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `notif-${Date.now()}`;
const password = 'test-passwort-123!';

class CapturingMailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe('Reminders & iCal (integration)', () => {
  let app: NestFastifyApplication;
  const mailer = new CapturingMailer();
  let reminders: ReminderService;
  let cookie: string;
  let assignmentId: string;

  beforeAll(async () => {
    app = await createTestApp((builder) => {
      builder.overrideProvider(MailerService).useValue(mailer);
    });
    reminders = app.get(ReminderService);

    const person = await prisma.person.create({
      data: {
        firstName: 'Remind',
        lastName: uniq,
        email: `${uniq}-remind@test.local`,
        account: {
          create: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
        },
      },
    });
    const team = await prisma.team.create({
      data: { name: `Team-${uniq}`, positions: { create: [{ name: 'Ton' }] } },
      include: { positions: true },
    });
    // Termin in 6 Tagen → bei Schwellen [7, 1] ist genau eine Erinnerung fällig
    const event = await prisma.event.create({
      data: {
        title: `Gottesdienst-${uniq}`,
        startsAt: new Date(Date.now() + 6 * 86_400_000),
        endsAt: new Date(Date.now() + 6 * 86_400_000 + 90 * 60_000),
        status: 'PUBLISHED',
        slots: { create: [{ positionId: team.positions[0].id, requiredCount: 1 }] },
      },
      include: { slots: true },
    });
    const assignment = await prisma.assignment.create({
      data: { slotId: event.slots[0].id, personId: person.id, status: 'ACCEPTED' },
    });
    assignmentId = assignment.id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-remind@test.local`, password },
    });
    cookie = sessionCookieFrom(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('verschickt fällige Erinnerung genau einmal (idempotenter Scan)', async () => {
    mailer.sent = [];
    const first = await reminders.scanAndSend();
    expect(first).toBeGreaterThanOrEqual(1);
    const mine = mailer.sent.filter((m) => m.to.includes(uniq));
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toContain('Erinnerung');

    // Zweiter Lauf direkt danach: nichts Neues für diese Einteilung
    mailer.sent = [];
    await reminders.scanAndSend();
    expect(mailer.sent.filter((m) => m.to.includes(uniq))).toHaveLength(0);

    const logs = await prisma.notificationLog.findMany({
      where: { assignmentId, kind: 'REMINDER' },
    });
    expect(logs).toHaveLength(1);
  });

  it('iCal-Feed: Token erzeugen, Feed abrufen, Rotation invalidiert alte URL', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/ical-token',
      headers: { cookie },
    });
    expect(create.statusCode).toBe(201);
    const url: string = create.json().url;
    const token = url.split('/ical/')[1];

    const feed = await app.inject({ method: 'GET', url: `/api/v1/ical/${token}` });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.body).toContain('BEGIN:VCALENDAR');
    expect(feed.body).toContain(`Gottesdienst-${uniq}`);
    expect(feed.body).toContain('STATUS:CONFIRMED');

    // Rotation: alter Token ist sofort ungültig
    await app.inject({ method: 'POST', url: '/api/v1/me/ical-token', headers: { cookie } });
    const stale = await app.inject({ method: 'GET', url: `/api/v1/ical/${token}` });
    expect(stale.statusCode).toBe(404);
  });

  it('falscher Feed-Token → 404, kein Datenleck', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/ical/quatsch-token.ics' });
    expect(response.statusCode).toBe(404);
  });
});
