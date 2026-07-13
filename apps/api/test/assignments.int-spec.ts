// Integrationstest des Kern-Workflows: einteilen → Mail mit Token-Link →
// Zusage/Absage ohne Login → Absage-Alert an Teamleiter mit Ersatz-
// Vorschlägen. Plus Negativtests für Einteilungs-Berechtigungen.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { MailMessage, MailerService } from '../src/notifications/mailer.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `assign-${Date.now()}`;
const password = 'test-passwort-123!';

// Fängt alle Mails ab, statt sie zu verschicken – die Tests fischen
// daraus die Respond-Tokens (wie es ein echter Empfänger täte)
class CapturingMailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

function extractToken(mailText: string): string {
  const match = mailText.match(/\/respond\/([A-Za-z0-9_-]+)\?/);
  if (!match) throw new Error(`Kein Respond-Link in der Mail:\n${mailText}`);
  return match[1];
}

describe('Assignments & Respond-Workflow (integration)', () => {
  let app: NestFastifyApplication;
  const mailer = new CapturingMailer();
  let adminCookie: string;
  let leaderCookie: string;
  let memberCookie: string;
  let slotId: string;
  let memberId: string;
  let secondId: string;
  let leaderId: string;

  async function createPerson(label: string, role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
    const person = await prisma.person.create({
      data: {
        firstName: label,
        lastName: uniq,
        email: `${uniq}-${label.toLowerCase()}@test.local`,
        account: {
          create: {
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
            globalRole: role,
          },
        },
      },
    });
    return person.id;
  }

  async function login(label: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-${label.toLowerCase()}@test.local`, password },
    });
    return sessionCookieFrom(response.headers['set-cookie']);
  }

  beforeAll(async () => {
    app = await createTestApp((builder) => {
      builder.overrideProvider(MailerService).useValue(mailer);
    });

    await createPerson('Admin', 'ADMIN');
    leaderId = await createPerson('Leader');
    memberId = await createPerson('Member');
    secondId = await createPerson('Second');

    const team = await prisma.team.create({
      data: {
        name: `Team-${uniq}`,
        positions: { create: [{ name: 'Ton' }] },
        memberships: {
          create: [
            { personId: leaderId, role: 'LEADER' },
            { personId: memberId },
            { personId: secondId },
          ],
        },
      },
      include: { positions: true },
    });
    await prisma.positionSkill.createMany({
      data: [
        { positionId: team.positions[0].id, personId: memberId, skillLevel: 'SOLID' },
        { positionId: team.positions[0].id, personId: secondId, skillLevel: 'EXPERT' },
      ],
    });

    const event = await prisma.event.create({
      data: {
        title: `Gottesdienst-${uniq}`,
        startsAt: new Date(Date.now() + 14 * 86_400_000),
        endsAt: new Date(Date.now() + 14 * 86_400_000 + 90 * 60_000),
        status: 'PUBLISHED',
        slots: { create: [{ positionId: team.positions[0].id, requiredCount: 2 }] },
      },
      include: { slots: true },
    });
    slotId = event.slots[0].id;

    adminCookie = await login('Admin');
    leaderCookie = await login('Leader');
    memberCookie = await login('Member');
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('MEMBER darf nicht einteilen (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: memberCookie },
      payload: { slotId, personId: secondId },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Vorschläge berücksichtigen Skills und faire Verteilung', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/assignments/suggestions?slotId=${slotId}`,
      headers: { cookie: leaderCookie },
    });
    expect(response.statusCode).toBe(200);
    const names = (response.json() as { name: string }[]).map((s) => s.name);
    expect(names).toContain(`Member ${uniq}`);
    expect(names).toContain(`Second ${uniq}`);
  });

  it('LEADER teilt ein → Person bekommt Mail mit Accept/Decline-Links', async () => {
    mailer.sent = [];
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: leaderCookie },
      payload: { slotId, personId: memberId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('REQUESTED');

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toContain('member');
    expect(mailer.sent[0].text).toContain('action=accept');
    expect(mailer.sent[0].text).toContain('action=decline');
  });

  it('Token-Link zeigt nur Vorname + Termin und nimmt die Zusage an', async () => {
    const token = extractToken(mailer.sent[0].text);

    const info = await app.inject({ method: 'GET', url: `/api/v1/respond/${token}` });
    expect(info.statusCode).toBe(200);
    expect(info.json().firstName).toBe('Member');
    // Keine Kontaktdaten, kein Nachname über den Link
    expect(JSON.stringify(info.json())).not.toContain('@test.local');

    const accept = await app.inject({ method: 'POST', url: `/api/v1/respond/${token}/accept` });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().status).toBe('ACCEPTED');

    const assignment = await prisma.assignment.findFirstOrThrow({
      where: { slotId, personId: memberId },
    });
    expect(assignment.status).toBe('ACCEPTED');
  });

  it('Token ist single-use: zweiter Versuch → 410 Gone', async () => {
    const token = extractToken(mailer.sent[0].text);
    const again = await app.inject({ method: 'POST', url: `/api/v1/respond/${token}/decline` });
    expect(again.statusCode).toBe(410);
    // Zusage bleibt bestehen
    const assignment = await prisma.assignment.findFirstOrThrow({
      where: { slotId, personId: memberId },
    });
    expect(assignment.status).toBe('ACCEPTED');
  });

  it('Absage benachrichtigt Teamleiter mit Ersatz-Vorschlägen', async () => {
    mailer.sent = [];
    // Admin teilt zweite Person ein
    const assign = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: adminCookie },
      payload: { slotId, personId: secondId },
    });
    expect(assign.statusCode).toBe(201);
    const token = extractToken(mailer.sent[0].text);

    mailer.sent = [];
    const decline = await app.inject({
      method: 'POST',
      url: `/api/v1/respond/${token}/decline`,
      payload: { reason: 'Bin im Urlaub' },
    });
    expect(decline.statusCode).toBe(200);

    // Leiter-Mail mit Grund und Vorschlägen
    const leaderMail = mailer.sent.find((m) => m.to.includes('leader'));
    expect(leaderMail).toBeDefined();
    expect(leaderMail!.text).toContain('Bin im Urlaub');
    expect(leaderMail!.subject).toContain('Second');

    const log = await prisma.notificationLog.findFirst({
      where: { kind: 'DECLINED_ALERT', personId: leaderId },
    });
    expect(log).not.toBeNull();
  });

  it('Doppelte Einteilung im selben Slot → 409', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: leaderCookie },
      payload: { slotId, personId: memberId },
    });
    expect(response.statusCode).toBe(409);
  });

  it('Einteilung einer abwesenden Person → 409 mit Konflikt-Code', async () => {
    // Second als abwesend eintragen (hat gerade abgesagt → Assignment
    // existiert noch; erst entfernen)
    await prisma.assignment.deleteMany({ where: { slotId, personId: secondId } });
    const event = await prisma.event.findFirstOrThrow({ where: { title: { contains: uniq } } });
    await prisma.absence.create({
      data: {
        personId: secondId,
        fromDate: new Date(event.startsAt.getTime() - 86_400_000),
        toDate: new Date(event.startsAt.getTime() + 86_400_000),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: leaderCookie },
      payload: { slotId, personId: secondId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('UNAVAILABLE');
  });

  it('„Meine Dienste": eingeloggte Person kann direkt antworten', async () => {
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/me/assignments',
      headers: { cookie: memberCookie },
    });
    expect(mine.statusCode).toBe(200);
    const assignment = mine.json()[0];
    expect(assignment.status).toBe('ACCEPTED');

    const respond = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assignments/${assignment.id}/respond`,
      headers: { cookie: memberCookie },
      payload: { action: 'DECLINED', reason: 'Krank' },
    });
    expect(respond.statusCode).toBe(200);
    expect(respond.json().status).toBe('DECLINED');
  });

  it('Fremde Einteilungen kann man nicht beantworten (404)', async () => {
    const foreign = await prisma.assignment.findFirst({ where: { personId: memberId } });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assignments/${foreign!.id}/respond`,
      headers: { cookie: leaderCookie },
      payload: { action: 'ACCEPTED' },
    });
    expect(response.statusCode).toBe(404);
  });
});
