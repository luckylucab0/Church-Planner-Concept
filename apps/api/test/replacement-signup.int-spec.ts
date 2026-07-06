// Integrationstests für Vertretung (Swap & Replace) und Selbst-Eintragung:
// die eingeteilte Person fragt selbst eine Vertretung per Token-Link an,
// Mitglieder tragen sich in freigegebene Slots selbst ein.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { MailMessage, MailerService } from '../src/notifications/mailer.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `repl-${Date.now()}`;
const password = 'test-passwort-123!';

class CapturingMailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

function extractReplacementToken(mailText: string): string {
  const match = mailText.match(/\/replacement\/([A-Za-z0-9_-]+)\?/);
  if (!match) throw new Error(`Kein Replacement-Link in der Mail:\n${mailText}`);
  return match[1];
}

describe('Vertretung & Selbst-Eintragung (integration)', () => {
  let app: NestFastifyApplication;
  const mailer = new CapturingMailer();
  let leaderCookie: string;
  let memberCookie: string;
  let otherCookie: string;
  let memberId: string;
  let helperId: string;
  let outsiderId: string;
  let slotId: string;
  let signupSlotId: string;
  let assignmentId: string;

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

    const leaderId = await createPerson('Leader');
    memberId = await createPerson('Member');
    helperId = await createPerson('Helper');
    outsiderId = await createPerson('Outsider');

    const team = await prisma.team.create({
      data: {
        name: `Team-${uniq}`,
        positions: { create: [{ name: 'Ton' }, { name: 'Theke' }] },
        memberships: {
          create: [
            { personId: leaderId, isLeader: true },
            { personId: memberId },
            { personId: helperId },
          ],
        },
      },
      include: { positions: true },
    });
    const tonId = team.positions.find((p) => p.name === 'Ton')!.id;
    const thekeId = team.positions.find((p) => p.name === 'Theke')!.id;
    await prisma.positionSkill.createMany({
      data: [
        { positionId: tonId, personId: memberId, skillLevel: 'SOLID' },
        { positionId: tonId, personId: helperId, skillLevel: 'SOLID' },
        { positionId: thekeId, personId: helperId, skillLevel: 'BEGINNER' },
      ],
    });

    const event = await prisma.event.create({
      data: {
        title: `Gottesdienst-${uniq}`,
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000 + 90 * 60_000),
        status: 'PUBLISHED',
        slots: { create: [{ positionId: tonId, requiredCount: 1 }] },
      },
      include: { slots: true },
    });
    slotId = event.slots[0].id;

    // Zweiter Termin für die Signup-Tests – Helper ist nach der Übernahme
    // im ersten Termin bereits eingeteilt (Same-Event-Sperre)
    const event2 = await prisma.event.create({
      data: {
        title: `Gottesdienst2-${uniq}`,
        startsAt: new Date(Date.now() + 14 * 86_400_000),
        endsAt: new Date(Date.now() + 14 * 86_400_000 + 90 * 60_000),
        status: 'PUBLISHED',
        slots: { create: [{ positionId: thekeId, requiredCount: 2 }] },
      },
      include: { slots: true },
    });
    signupSlotId = event2.slots[0].id;

    const assignment = await prisma.assignment.create({
      data: { slotId, personId: memberId, status: 'ACCEPTED', assignedById: leaderId },
    });
    assignmentId = assignment.id;

    leaderCookie = await login('leader');
    memberCookie = await login('member');
    otherCookie = await login('outsider');
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  // --- Vertretung -------------------------------------------

  it('nur die eingeteilte Person sieht Vertretungs-Kandidaten (404 für andere)', async () => {
    const asOther = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assignments/${assignmentId}/replacement-candidates`,
      headers: { cookie: otherCookie },
    });
    expect(asOther.statusCode).toBe(404);

    const asOwner = await app.inject({
      method: 'GET',
      url: `/api/v1/me/assignments/${assignmentId}/replacement-candidates`,
      headers: { cookie: memberCookie },
    });
    expect(asOwner.statusCode).toBe(200);
    const names = asOwner.json().map((c: { name: string }) => c.name);
    expect(names).toContain(`Helper ${uniq}`);
    // Sich selbst schlägt die Liste nicht vor
    expect(names).not.toContain(`Member ${uniq}`);
    // Nur Namen, keine Kontaktdaten
    expect(asOwner.json()[0]).not.toHaveProperty('email');
  });

  it('lehnt ungeeignete Kandidaten ab (403: keine Position)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assignments/${assignmentId}/replacement-request`,
      headers: { cookie: memberCookie },
      payload: { candidatePersonId: outsiderId },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Vertretung anfragen → Kandidat bekommt Mail mit Token-Link', async () => {
    mailer.sent = [];
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assignments/${assignmentId}/replacement-request`,
      headers: { cookie: memberCookie },
      payload: { candidatePersonId: helperId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().candidateName).toBe(`Helper ${uniq}`);

    const mail = mailer.sent.find((m) => m.to === `${uniq}-helper@test.local`);
    expect(mail).toBeDefined();
    expect(mail!.text).toContain(`Member ${uniq}`);
  });

  it('zweite Anfrage parallel ist blockiert (409)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/me/assignments/${assignmentId}/replacement-request`,
      headers: { cookie: memberCookie },
      payload: { candidatePersonId: helperId },
    });
    expect(response.statusCode).toBe(409);
  });

  it('"Meine Dienste" zeigt die laufende Anfrage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me/assignments',
      headers: { cookie: memberCookie },
    });
    const mine = response.json().find((a: { id: string }) => a.id === assignmentId);
    expect(mine.pendingReplacement).toEqual({ candidateName: `Helper ${uniq}` });
  });

  it('Übernahme per Token: Einteilung wandert, alle werden informiert', async () => {
    const mail = mailer.sent.find((m) => m.to === `${uniq}-helper@test.local`)!;
    const token = extractReplacementToken(mail.text);

    const info = await app.inject({ method: 'GET', url: `/api/v1/replacement/${token}` });
    expect(info.statusCode).toBe(200);
    expect(info.json().requesterFirstName).toBe('Member');
    expect(info.json()).not.toHaveProperty('email');

    mailer.sent = [];
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/replacement/${token}/accept`,
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().status).toBe('ACCEPTED');

    // Alte Einteilung dokumentiert abgesagt, neue Zusage für die Vertretung
    const old = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(old.status).toBe('DECLINED');
    expect(old.declineReason).toContain('Helper');
    const replacement = await prisma.assignment.findUniqueOrThrow({
      where: { slotId_personId: { slotId, personId: helperId } },
    });
    expect(replacement.status).toBe('ACCEPTED');

    // Anfragende Person + Teamleitung informiert
    expect(mailer.sent.map((m) => m.to)).toEqual(
      expect.arrayContaining([`${uniq}-member@test.local`, `${uniq}-leader@test.local`]),
    );

    // Token ist single-use
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/replacement/${token}/accept`,
    });
    expect(again.statusCode).toBe(410);
  });

  // --- Selbst-Eintragung -------------------------------------

  it('Mitglied darf Slot nicht selbst freigeben (403), Teamleiter schon', async () => {
    const asMember = await app.inject({
      method: 'PATCH',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: memberCookie },
      payload: { open: true },
    });
    expect(asMember.statusCode).toBe(403);

    const asLeader = await app.inject({
      method: 'PATCH',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: leaderCookie },
      payload: { open: true },
    });
    expect(asLeader.statusCode).toBe(200);
    expect(asLeader.json().openForSignup).toBe(true);
  });

  it('offene Dienste erscheinen nur für Personen mit passender Position', async () => {
    // Helper hat die Theke-Position → sieht den Slot
    const helperCookie = await login('helper');
    const forHelper = await app.inject({
      method: 'GET',
      url: '/api/v1/signup/open',
      headers: { cookie: helperCookie },
    });
    expect(forHelper.json().map((s: { slotId: string }) => s.slotId)).toContain(signupSlotId);

    // Outsider hat keine Position → leere Liste
    const forOutsider = await app.inject({
      method: 'GET',
      url: '/api/v1/signup/open',
      headers: { cookie: otherCookie },
    });
    expect(forOutsider.json()).toEqual([]);
  });

  it('ohne Positions-Zuordnung keine Eintragung (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: otherCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Selbst-Eintragung zählt als Zusage und informiert die Teamleitung', async () => {
    mailer.sent = [];
    const helperCookie = await login('helper');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: helperCookie },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('ACCEPTED');
    expect(mailer.sent.map((m) => m.to)).toContain(`${uniq}-leader@test.local`);

    // Doppelt eintragen geht nicht
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: helperCookie },
    });
    expect(again.statusCode).toBe(409);
  });

  it('geschlossener Slot lässt keine Eintragung zu (403)', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: leaderCookie },
      payload: { open: false },
    });
    const helperCookie = await login('helper');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/signup/slots/${signupSlotId}`,
      headers: { cookie: helperCookie },
    });
    expect(response.statusCode).toBe(403);
  });
});
