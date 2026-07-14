// Integrationstest für den kompletten 2FA-Lebenszyklus: Einrichtung
// (QR + Backup-Codes + Bestätigung), Login mit TOTP, Login mit
// Backup-Code (single-use), Codes erneuern, Deaktivieren per Passwort.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `twofa-${Date.now()}`;
const email = `${uniq}@test.local`;
const password = 'korrekt-pferd-batterie-1!';

describe('2FA (integration)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  let secret: string;
  let backupCodes: string[];

  async function login(totpCode?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password, ...(totpCode ? { totpCode } : {}) },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await prisma.person.create({
      data: {
        firstName: 'Zwei',
        lastName: uniq,
        email,
        account: {
          create: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
        },
      },
    });
    cookie = sessionCookieFrom((await login()).headers['set-cookie']);
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('Setup liefert QR-Data-URL, Secret und 10 Backup-Codes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/setup',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.otpauthUrl).toContain('otpauth://totp/');
    expect(body.secret).toBeDefined();
    expect(body.backupCodes).toHaveLength(10);
    expect(body.backupCodes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    secret = body.secret;
    backupCodes = body.backupCodes;

    // Noch nicht aktiv – Login verlangt keinen Code
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/2fa/status',
      headers: { cookie },
    });
    expect(status.json().enabled).toBe(false);
  });

  it('falscher Code aktiviert nicht (401), gültiger Code schon', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      headers: { cookie },
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      headers: { cookie },
      payload: { code: authenticator.generate(secret) },
    });
    expect(ok.statusCode).toBe(204);

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/2fa/status',
      headers: { cookie },
    });
    expect(status.json()).toEqual({ enabled: true, backupCodesRemaining: 10 });
  });

  it('Login verlangt jetzt einen Code (TOTP_REQUIRED) und akzeptiert TOTP', async () => {
    const withoutCode = await login();
    expect(withoutCode.statusCode).toBe(401);
    expect(withoutCode.json().code).toBe('TOTP_REQUIRED');

    const withCode = await login(authenticator.generate(secret));
    expect(withCode.statusCode).toBe(200);
  });

  it('Backup-Code funktioniert genau einmal', async () => {
    const code = backupCodes[0];
    const first = await login(code.toUpperCase()); // Groß-/Kleinschreibung egal
    expect(first.statusCode).toBe(200);

    const replay = await login(code);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().message).toBe('auth.invalidCredentials');

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/2fa/status',
      headers: { cookie },
    });
    expect(status.json().backupCodesRemaining).toBe(9);
  });

  it('neue Backup-Codes ersetzen die alten (TOTP-Nachweis nötig)', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/backup-codes',
      headers: { cookie },
      payload: { code: '000000' },
    });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/backup-codes',
      headers: { cookie },
      payload: { code: authenticator.generate(secret) },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().backupCodes).toHaveLength(10);

    // Alter (unverbrauchter) Code ist damit wertlos
    const oldCode = await login(backupCodes[1]);
    expect(oldCode.statusCode).toBe(401);
    backupCodes = response.json().backupCodes;
  });

  it('Deaktivieren verlangt das Passwort und schaltet 2FA ab', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { cookie },
      payload: { password: 'falsch-falsch-falsch' },
    });
    expect(denied.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { cookie },
      payload: { password },
    });
    expect(ok.statusCode).toBe(204);

    // Login geht wieder ohne Code; Backup-Codes sind gelöscht
    const plain = await login();
    expect(plain.statusCode).toBe(200);
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/2fa/status',
      headers: { cookie },
    });
    expect(status.json()).toEqual({ enabled: false, backupCodesRemaining: 0 });
  });
});
