// Integrationstest Benutzer-Anträge: Teamleiter beantragen neue User,
// Admins entscheiden. Genehmigung erstellt Person + Team-Mitgliedschaft
// und stößt die Einladung an – bis hin zum Login der neuen Person.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { MailMessage, MailerService } from '../src/notifications/mailer.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `userreq-${Date.now()}`;
const password = 'test-passwort-123!';

class CapturingMailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe('Benutzer-Anträge (integration)', () => {
  let app: NestFastifyApplication;
  const mailer = new CapturingMailer();
  let adminCookie: string;
  let leaderCookie: string;
  let memberCookie: string;
  let teamAId: string;
  let teamBId: string;

  async function createPerson(label: string, role: 'ADMIN' | 'MEMBER') {
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

  async function loginCookie(label: string, pw = password) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-${label.toLowerCase()}@test.local`, password: pw },
    });
    return sessionCookieFrom(response.headers['set-cookie']);
  }

  function requestPayload(overrides: Record<string, unknown> = {}) {
    return {
      firstName: 'Nora',
      lastName: 'Neu',
      email: `${uniq}-nora@test.local`,
      phone: '+41 79 555 66 77',
      teamId: teamAId,
      ...overrides,
    };
  }

  beforeAll(async () => {
    app = await createTestApp((builder) => {
      builder.overrideProvider(MailerService).useValue(mailer);
    });
    await createPerson('Admin', 'ADMIN');
    const leaderId = await createPerson('Leader', 'MEMBER');
    await createPerson('Member', 'MEMBER');

    const teamA = await prisma.team.create({
      data: {
        name: `Team-A-${uniq}`,
        memberships: { create: [{ personId: leaderId, role: 'LEADER' }] },
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({ data: { name: `Team-B-${uniq}` } });
    teamBId = teamB.id;

    adminCookie = await loginCookie('Admin');
    leaderCookie = await loginCookie('Leader');
    memberCookie = await loginCookie('Member');
  });

  afterAll(async () => {
    await prisma.userAccountRequest.deleteMany({ where: { email: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('nur Leiter des gewählten Teams dürfen beantragen', async () => {
    const asMember = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: memberCookie },
      payload: requestPayload(),
    });
    expect(asMember.statusCode).toBe(403);

    const wrongTeam = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
      payload: requestPayload({ teamId: teamBId }),
    });
    expect(wrongTeam.statusCode).toBe(403);
  });

  it('Duplikate werden abgewiesen (bestehende Person, offener Antrag)', async () => {
    const existing = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
      payload: requestPayload({ email: `${uniq}-member@test.local` }),
    });
    expect(existing.statusCode).toBe(409);

    mailer.sent = [];
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
      payload: requestPayload({ email: `${uniq}-doppelt@test.local` }),
    });
    expect(first.statusCode).toBe(201);
    // Admin wurde benachrichtigt
    expect(mailer.sent.some((m) => m.to === `${uniq}-admin@test.local`)).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
      // Groß-/Kleinschreibung darf den Duplikat-Check nicht umgehen
      payload: requestPayload({ email: `${uniq.toUpperCase()}-DOPPELT@test.local`.toLowerCase() }),
    });
    expect(second.statusCode).toBe(409);
  });

  it('Sichtbarkeit: Admin sieht alle, Leiter nur eigene, Mitglied nichts', async () => {
    const asAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/user-requests?status=PENDING',
      headers: { cookie: adminCookie },
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().length).toBeGreaterThanOrEqual(1);

    const asLeader = await app.inject({
      method: 'GET',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
    });
    expect(asLeader.json().every((r: { requestedByName: string }) => r.requestedByName)).toBe(true);

    const asMember = await app.inject({
      method: 'GET',
      url: '/api/v1/user-requests',
      headers: { cookie: memberCookie },
    });
    expect(asMember.statusCode).toBe(200);
    expect(asMember.json()).toEqual([]);
  });

  it('Genehmigung: Person + Mitgliedschaft entstehen, Einladung + Ergebnis-Mail, E2E-Login', async () => {
    mailer.sent = [];
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
      payload: requestPayload(),
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json().id;

    // Nur Admins dürfen entscheiden
    const asMember = await app.inject({
      method: 'POST',
      url: `/api/v1/user-requests/${requestId}/approve`,
      headers: { cookie: memberCookie },
      payload: {},
    });
    expect(asMember.statusCode).toBe(403);

    mailer.sent = [];
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/user-requests/${requestId}/approve`,
      headers: { cookie: adminCookie },
      payload: { comment: 'Willkommen im Team' },
    });
    expect(approve.statusCode).toBe(204);

    // Person existiert mit Mitgliedschaft im beantragten Team
    const person = await prisma.person.findUnique({
      where: { email: `${uniq}-nora@test.local` },
      include: { memberships: true, account: true },
    });
    expect(person).not.toBeNull();
    expect(person!.account).toBeNull(); // Konto erst nach Bestätigung
    expect(person!.memberships).toEqual([
      expect.objectContaining({ teamId: teamAId, role: 'MEMBER' }),
    ]);

    // Einladung an die neue Person, Ergebnis-Mail an den Leiter
    const inviteMail = mailer.sent.find((m) => m.to === `${uniq}-nora@test.local`);
    expect(inviteMail?.text).toContain('/invite?token=');
    const resultMail = mailer.sent.find((m) => m.to === `${uniq}-leader@test.local`);
    expect(resultMail?.text).toContain('Willkommen im Team');

    // Kompletter Durchstich: Einladung bestätigen und einloggen
    const token = inviteMail!.text.match(/\/invite\?token=([A-Za-z0-9_-]+)/)![1];
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token, password: 'nora-ihr-passwort-1!' },
    });
    expect(confirm.statusCode).toBe(204);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-nora@test.local`, password: 'nora-ihr-passwort-1!' },
    });
    expect(login.statusCode).toBe(200);

    // Zweite Entscheidung auf demselben Antrag scheitert
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/user-requests/${requestId}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('Ablehnung: Status + Kommentar, Ergebnis-Mail an den Antragsteller', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/user-requests',
      headers: { cookie: leaderCookie },
      payload: requestPayload({ email: `${uniq}-abgelehnt@test.local` }),
    });
    const requestId = created.json().id;

    mailer.sent = [];
    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/user-requests/${requestId}/reject`,
      headers: { cookie: adminCookie },
      payload: { comment: 'Bitte zuerst mit mir besprechen' },
    });
    expect(reject.statusCode).toBe(204);

    const resultMail = mailer.sent.find((m) => m.to === `${uniq}-leader@test.local`);
    expect(resultMail?.text).toContain('Bitte zuerst mit mir besprechen');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/user-requests?status=REJECTED',
      headers: { cookie: adminCookie },
    });
    expect(list.json().some((r: { id: string; status: string }) => r.id === requestId)).toBe(true);

    // Keine Person entstanden
    const person = await prisma.person.findUnique({
      where: { email: `${uniq}-abgelehnt@test.local` },
    });
    expect(person).toBeNull();
  });
});
