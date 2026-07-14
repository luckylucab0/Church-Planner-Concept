// Integrationstests für Login, Session-Schutz und Rollen-Grenzen –
// gegen echte Postgres + Redis (dev-Container bzw. CI-Services).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

// Eindeutiges Präfix, damit parallele/wiederholte Läufe sich nicht beißen
const uniq = `auth-${Date.now()}`;
const memberEmail = `${uniq}-member@test.local`;
const password = 'korrekt-pferd-batterie-1!';

describe('Auth (integration)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await prisma.person.create({
      data: {
        firstName: 'Test',
        lastName: 'Member',
        email: memberEmail,
        account: {
          create: {
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
            globalRole: 'MEMBER',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { email: { startsWith: uniq } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('lehnt falsches Passwort mit generischer Meldung ab', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: memberEmail, password: 'falsch-falsch-falsch' },
    });
    expect(response.statusCode).toBe(401);
    // Generische Meldung: kein Unterschied zu "Konto existiert nicht"
    expect(response.json().message).toBe('auth.invalidCredentials');
  });

  it('lehnt unbekannte E-Mail mit identischer Meldung ab (keine User Enumeration)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-gibtsnicht@test.local`, password: 'egal-egal-egal' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('auth.invalidCredentials');
  });

  it('setzt bei korrektem Login ein HttpOnly-Session-Cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: memberEmail, password },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ globalRole: 'MEMBER', firstName: 'Test' });

    const rawCookie = response.headers['set-cookie'];
    const cookieString = Array.isArray(rawCookie) ? rawCookie.join(';') : (rawCookie ?? '');
    expect(cookieString).toContain('HttpOnly');
    expect(cookieString).toContain('SameSite=Lax');
  });

  it('schützt Routen ohne Session (secure by default)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(response.statusCode).toBe(401);
  });

  it('liefert Session-Info mit gültigem Cookie und beendet sie per Logout', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: memberEmail, password },
    });
    const cookie = sessionCookieFrom(login.headers['set-cookie']);

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().globalRole).toBe('MEMBER');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    // Session ist serverseitig zerstört – Cookie-Replay funktioniert nicht
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('blockt zustandsändernde Requests mit fremdem Origin (CSRF)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example.com' },
      payload: { email: memberEmail, password },
    });
    expect(response.statusCode).toBe(403);
  });

  describe('Passwort ändern (eingeloggt)', () => {
    const changeEmail = `${uniq}-change@test.local`;
    const newPassword = 'neues-sicheres-passwort-9!';

    beforeAll(async () => {
      await prisma.person.create({
        data: {
          firstName: 'Change',
          lastName: 'Pw',
          email: changeEmail,
          account: {
            create: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
          },
        },
      });
    });

    async function loginChange(pw: string) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: changeEmail, password: pw },
      });
      return sessionCookieFrom(response.headers['set-cookie']);
    }

    it('lehnt falsches aktuelles Passwort ab (401)', async () => {
      const cookie = await loginChange(password);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: { cookie },
        payload: { currentPassword: 'falsch-falsch-falsch', newPassword },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().message).toBe('auth.wrongPassword');
    });

    it('lehnt zu kurzes neues Passwort ab (400)', async () => {
      const cookie = await loginChange(password);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: { cookie },
        payload: { currentPassword: password, newPassword: 'kurz' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('ändert das Passwort, beendet andere Sessions und behält die eigene', async () => {
      const otherCookie = await loginChange(password); // zweites "Gerät"
      const ownCookie = await loginChange(password);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: { cookie: ownCookie },
        payload: { currentPassword: password, newPassword },
      });
      expect(response.statusCode).toBe(204);

      // Eigene Session lebt weiter, die andere ist tot
      const own = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: ownCookie },
      });
      expect(own.statusCode).toBe(200);
      const other = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: otherCookie },
      });
      expect(other.statusCode).toBe(401);

      // Login nur noch mit dem neuen Passwort
      const oldLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: changeEmail, password },
      });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: changeEmail, password: newPassword },
      });
      expect(newLogin.statusCode).toBe(200);
    });
  });

  it('sperrt Konto nach wiederholten Fehlversuchen (Lockout-Backoff)', async () => {
    const lockEmail = `${uniq}-lock@test.local`;
    await prisma.person.create({
      data: {
        firstName: 'Lock',
        lastName: 'Out',
        email: lockEmail,
        account: {
          create: {
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          },
        },
      },
    });

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: lockEmail, password: 'falsch-falsch-falsch' },
      });
    }
    // Konto ist jetzt gesperrt – auch das RICHTIGE Passwort wird abgelehnt
    const locked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: lockEmail, password },
    });
    expect(locked.statusCode).toBe(401);
  });
});
