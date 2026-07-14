// Integrationstest Passwort-Reset: Anforderung per Mail-Link (ohne
// User-Enumeration), Token-Confirm (single-use), Session-Invalidierung
// und der Admin-Anstoß für eine andere Person.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { MailMessage, MailerService } from '../src/notifications/mailer.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `pwreset-${Date.now()}`;
const password = 'korrekt-pferd-batterie-1!';
const newPassword = 'ganz-neues-passwort-42!';

class CapturingMailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

function extractResetToken(mailText: string): string {
  const match = mailText.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`Kein Reset-Link in der Mail:\n${mailText}`);
  return match[1];
}

describe('Passwort-Reset (integration)', () => {
  let app: NestFastifyApplication;
  const mailer = new CapturingMailer();
  let memberId: string;

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

  async function login(label: string, pw = password) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-${label.toLowerCase()}@test.local`, password: pw },
    });
  }

  beforeAll(async () => {
    app = await createTestApp((builder) => {
      builder.overrideProvider(MailerService).useValue(mailer);
    });
    await createPerson('Admin', 'ADMIN');
    memberId = await createPerson('Member');
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('antwortet für bekannte und unbekannte Adressen identisch (204)', async () => {
    mailer.sent = [];
    const known = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset',
      payload: { email: `${uniq}-member@test.local` },
    });
    expect(known.statusCode).toBe(204);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].text).toContain('/reset-password?token=');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset',
      payload: { email: `${uniq}-gibtsnicht@test.local` },
    });
    expect(unknown.statusCode).toBe(204);
    expect(mailer.sent).toHaveLength(1); // keine zweite Mail
  });

  it('setzt das Passwort per Token, beendet Sessions, Token ist single-use', async () => {
    // Bestehende Session, die durch den Reset sterben muss
    const oldSession = sessionCookieFrom((await login('Member')).headers['set-cookie']);

    const token = extractResetToken(mailer.sent[0].text);
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword },
    });
    expect(confirm.statusCode).toBe(204);

    // Alte Session tot, altes Passwort ungültig, neues funktioniert
    const dead = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: oldSession },
    });
    expect(dead.statusCode).toBe(401);
    expect((await login('Member')).statusCode).toBe(401);
    expect((await login('Member', newPassword)).statusCode).toBe(200);

    // Replay desselben Tokens scheitert
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'noch-ein-anderes-pw-7!' },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('Admin stößt die Reset-Mail für eine Person an, Mitglieder nicht (403)', async () => {
    const adminCookie = sessionCookieFrom((await login('Admin')).headers['set-cookie']);
    const memberCookie = sessionCookieFrom(
      (await login('Member', newPassword)).headers['set-cookie'],
    );

    const asMember = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/password-reset/for/${memberId}`,
      headers: { cookie: memberCookie },
    });
    expect(asMember.statusCode).toBe(403);

    mailer.sent = [];
    const asAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/password-reset/for/${memberId}`,
      headers: { cookie: adminCookie },
    });
    expect(asAdmin.statusCode).toBe(204);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(`${uniq}-member@test.local`);
    expect(mailer.sent[0].text).toContain('/reset-password?token=');
  });
});
