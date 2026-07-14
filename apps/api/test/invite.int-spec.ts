// Integrationstest Einladungs-Flow: Admin lädt eine Person ohne Konto
// ein, die Person setzt per Mail-Link ihr Passwort und bekommt damit ihr
// Konto. Tokens sind single-use, erneutes Einladen invalidiert alte Links.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { MailMessage, MailerService } from '../src/notifications/mailer.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `invite-${Date.now()}`;
const password = 'test-passwort-123!';
const newPassword = 'mein-neues-passwort-9!';

class CapturingMailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

function extractInviteToken(mailText: string): string {
  const match = mailText.match(/\/invite\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`Kein Einladungslink in der Mail:\n${mailText}`);
  return match[1];
}

describe('Einladungs-Flow (integration)', () => {
  let app: NestFastifyApplication;
  const mailer = new CapturingMailer();
  let adminCookie: string;
  let memberCookie: string;
  let inviteeId: string;
  let noMailId: string;

  async function createAccountPerson(label: string, role: 'ADMIN' | 'MEMBER') {
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

  async function login(email: string, pw: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: pw },
    });
  }

  beforeAll(async () => {
    app = await createTestApp((builder) => {
      builder.overrideProvider(MailerService).useValue(mailer);
    });
    await createAccountPerson('Admin', 'ADMIN');
    await createAccountPerson('Member', 'MEMBER');
    // Die Einzuladende: Person ohne Konto (z. B. frisch erfasst/importiert)
    const invitee = await prisma.person.create({
      data: {
        firstName: 'Neue',
        lastName: uniq,
        email: `${uniq}-neue@test.local`,
        privacySettings: { create: {} },
      },
    });
    inviteeId = invitee.id;
    const noMail = await prisma.person.create({
      data: { firstName: 'OhneMail', lastName: uniq, privacySettings: { create: {} } },
    });
    noMailId = noMail.id;

    adminCookie = sessionCookieFrom(
      (await login(`${uniq}-admin@test.local`, password)).headers['set-cookie'],
    );
    memberCookie = sessionCookieFrom(
      (await login(`${uniq}-member@test.local`, password)).headers['set-cookie'],
    );
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('nur Admins dürfen einladen (403 für Mitglieder)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invite/for/${inviteeId}`,
      headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Einladung an Person mit Konto oder ohne E-Mail schlägt fehl (400)', async () => {
    const admins = await prisma.person.findFirst({
      where: { email: `${uniq}-admin@test.local` },
      select: { id: true },
    });
    const withAccount = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invite/for/${admins!.id}`,
      headers: { cookie: adminCookie },
    });
    expect(withAccount.statusCode).toBe(400);

    const withoutMail = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invite/for/${noMailId}`,
      headers: { cookie: adminCookie },
    });
    expect(withoutMail.statusCode).toBe(400);
  });

  it('Admin lädt ein, Person setzt Passwort, Konto entsteht, Token ist single-use', async () => {
    mailer.sent = [];
    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invite/for/${inviteeId}`,
      headers: { cookie: adminCookie },
    });
    expect(invite.statusCode).toBe(204);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(`${uniq}-neue@test.local`);
    const token = extractInviteToken(mailer.sent[0].text);

    // Zu kurzes Passwort wird abgelehnt, Token bleibt gültig
    const tooShort = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token, password: 'kurz' },
    });
    expect(tooShort.statusCode).toBe(400);

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token, password: newPassword },
    });
    expect(confirm.statusCode).toBe(204);

    const account = await prisma.userAccount.findUnique({ where: { personId: inviteeId } });
    expect(account).not.toBeNull();
    expect(account!.globalRole).toBe('MEMBER');

    const loginResponse = await login(`${uniq}-neue@test.local`, newPassword);
    expect(loginResponse.statusCode).toBe(200);

    // Replay desselben Tokens scheitert (Konto existiert + Token verbraucht)
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token, password: 'noch-ein-passwort-1!' },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('erneutes Einladen invalidiert den alten Link', async () => {
    const person = await prisma.person.create({
      data: {
        firstName: 'Zweite',
        lastName: uniq,
        email: `${uniq}-zweite@test.local`,
        privacySettings: { create: {} },
      },
    });

    mailer.sent = [];
    await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invite/for/${person.id}`,
      headers: { cookie: adminCookie },
    });
    const oldToken = extractInviteToken(mailer.sent[0].text);

    mailer.sent = [];
    await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invite/for/${person.id}`,
      headers: { cookie: adminCookie },
    });
    const freshToken = extractInviteToken(mailer.sent[0].text);

    const withOld = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token: oldToken, password: newPassword },
    });
    expect(withOld.statusCode).toBe(401);

    const withFresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token: freshToken, password: newPassword },
    });
    expect(withFresh.statusCode).toBe(204);
  });

  it('Passwort-Reset-Token funktioniert nicht als Einladung', async () => {
    // Reset-Mail für die inzwischen eingerichtete Person anfordern
    mailer.sent = [];
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset',
      payload: { email: `${uniq}-neue@test.local` },
    });
    const resetToken = mailer.sent[0].text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/confirm',
      payload: { token: resetToken, password: newPassword },
    });
    expect(response.statusCode).toBe(401);
  });
});
