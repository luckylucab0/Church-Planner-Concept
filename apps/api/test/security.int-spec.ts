// Regressionstests zum Security-Assessment vom September 2026
// (siehe docs/security-assessment-2026-09.md).
//
// Jeder Test hier gehört zu genau einem Befund und würde vor dem
// zugehörigen Fix fehlschlagen. Sie sind bewusst in einer eigenen Datei
// gebündelt, damit beim nächsten Assessment sofort sichtbar ist, welche
// Angriffe bereits abgedeckt sind.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import {
  createTestApp,
  sessionCookieFrom,
  testPrisma as prisma,
  waitForAuditEntry,
} from './utils/create-test-app';

const uniq = `sec-${Date.now()}`;
const email = `${uniq}@test.local`;
const password = 'korrekt-pferd-batterie-1!';

describe('Security-Regressionen (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let personId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const person = await prisma.person.create({
      data: {
        firstName: 'Sec',
        lastName: uniq,
        email,
        account: {
          create: {
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
            globalRole: 'ADMIN',
          },
        },
      },
    });
    personId = person.id;
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    adminCookie = sessionCookieFrom(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await prisma.importJob.deleteMany({ where: { startedById: personId } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  // --- SF-11: 2FA-Fehlversuche zählen zum Lockout -----------------
  describe('Zweiter Faktor ist gegen Bruteforce geschützt', () => {
    const totpEmail = `${uniq}-totp@test.local`;
    let totpSecret: string;
    let accountId: string;

    const login = (totpCode?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: totpEmail, password, ...(totpCode ? { totpCode } : {}) },
      });

    beforeAll(async () => {
      const person = await prisma.person.create({
        data: {
          firstName: 'Totp',
          lastName: uniq,
          email: totpEmail,
          account: {
            create: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
          },
        },
        include: { account: true },
      });
      accountId = person.account!.id;

      const cookie = sessionCookieFrom((await login()).headers['set-cookie']);
      const setup = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/2fa/setup',
        headers: { cookie },
      });
      expect(setup.statusCode).toBe(201);
      totpSecret = setup.json().secret;

      // Erst der zweite Anlauf, falls zwischen Erzeugen und Pruefen des Codes
      // das 30-s-Zeitfenster gewechselt hat.
      let verify = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/2fa/verify',
        headers: { cookie },
        payload: { code: authenticator.generate(totpSecret) },
      });
      if (verify.statusCode !== 204) {
        verify = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/2fa/verify',
          headers: { cookie },
          payload: { code: authenticator.generate(totpSecret) },
        });
      }

      // Diese Zusicherung ist der Kern: Ohne aktives 2FA ignoriert der Login
      // den totpCode und antwortet mit 200 statt 401. Ein still
      // fehlgeschlagenes Setup wuerde die folgenden Tests also das Falsche
      // pruefen lassen – und zwar als scheinbar echten Fehlschlag.
      expect(verify.statusCode).toBe(204);
      const account = await prisma.userAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.totpEnabled).toBe(true);
    });

    beforeEach(async () => {
      await prisma.userAccount.update({
        where: { id: accountId },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    });

    it('falsche TOTP-Codes erhöhen den Fehlversuchszähler und sperren das Konto', async () => {
      // Vor dem Fix blieb failedLoginCount bei 0: Wer das Passwort kannte,
      // konnte TOTP-Codes unbegrenzt raten.
      for (let i = 0; i < 6; i++) {
        expect((await login('000000')).statusCode).toBe(401);
      }

      const account = await prisma.userAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.failedLoginCount).toBeGreaterThanOrEqual(5);
      expect(account.lockedUntil).not.toBeNull();

      // Selbst mit gültigem Code kommt man jetzt nicht mehr rein.
      expect((await login(authenticator.generate(totpSecret))).statusCode).toBe(401);
    });

    it('ein bereits benutzter TOTP-Code wird kein zweites Mal akzeptiert', async () => {
      const code = authenticator.generate(totpSecret);
      expect((await login(code)).statusCode).toBe(200);

      // Replay innerhalb desselben Zeitfensters muss scheitern.
      const replay = await login(code);
      expect(replay.statusCode).toBe(401);
      expect(replay.json().message).toBe('auth.invalidCredentials');
    });
  });

  // --- SF-22: Audit-Log erfasst die Herkunft ----------------------
  describe('Audit-Log haelt die Client-IP fest', () => {
    // Eine auditierte Aktion ausloesen und den juengsten Eintrag dazu holen.
    async function auditEntryForRename(headers: Record<string, string> = {}) {
      const target = await prisma.person.create({
        data: { firstName: 'Audit', lastName: uniq, email: `${uniq}-${Date.now()}@test.local` },
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/people/${target.id}`,
        headers: { cookie: adminCookie, ...headers },
        payload: { firstName: 'Umbenannt' },
      });
      expect(response.statusCode).toBe(200);

      // AuditService schreibt bewusst fire-and-forget – der Helfer wartet,
      // bis der Eintrag da ist.
      return waitForAuditEntry({
        entityType: 'Person',
        entityId: target.id,
        action: 'UPDATE',
      });
    }

    it('schreibt die IP auch bei Aktionen ausserhalb des Logins', async () => {
      // Vor dem Fix stand hier NULL: Nur LOGIN und LOGIN_FAILED uebergaben
      // eine IP, alle uebrigen ~60 Aufrufstellen nicht.
      const entry = await auditEntryForRename();
      expect(entry.ip).toBe('127.0.0.1');
    });

    it('nimmt hinter dem Reverse Proxy die IP aus X-Forwarded-For', async () => {
      // Produktiv steht Caddy davor; ohne trustProxy stuende hier die IP des
      // Proxys statt der des Clients – und das Audit-Log waere wertlos.
      const entry = await auditEntryForRename({ 'x-forwarded-for': '203.0.113.42' });
      expect(entry.ip).toBe('203.0.113.42');
    });
  });

  // --- SF-06: Session-Cookie ist signiert -------------------------
  it('ein manipuliertes Session-Cookie wird an der Signatur erkannt', async () => {
    const value = adminCookie.slice('serveflow_session='.length);
    // Letztes Zeichen der Signatur verändern.
    const tampered = `serveflow_session=${value.slice(0, -1)}${value.endsWith('a') ? 'b' : 'a'}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: tampered },
    });
    expect(response.statusCode).toBe(401);

    // Das unveränderte Cookie funktioniert weiterhin.
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(200);
  });

  // --- SF-10: Token gilt nur für seinen Zweck ---------------------
  it('ein INVITE-Token wird am Passwort-Reset-Endpunkt abgelehnt', async () => {
    const invitee = await prisma.person.create({
      data: { firstName: 'Ein', lastName: uniq, email: `${uniq}-invite@test.local` },
    });
    // Konto anlegen, damit die Ablehnung NICHT bloß daher rührt, dass die
    // Person kein Konto hat – geprüft werden soll der Purpose.
    await prisma.userAccount.create({
      data: {
        personId: invitee.id,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    const rawToken = 'invite-token-fuer-den-purpose-test';
    const { createHash } = await import('node:crypto');
    await prisma.authToken.create({
      data: {
        personId: invitee.id,
        purpose: 'INVITE',
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: rawToken, newPassword: 'ein-neues-passwort-9!' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('auth.invalidResetToken');
  });

  // --- SF-18: CSV-Formel-Injection --------------------------------
  it('der Import-Fehlerreport entschärft Formel-Präfixe', async () => {
    const formula = "=cmd|' /C calc'!A0";
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/import',
      headers: { cookie: adminCookie },
      payload: {
        source: 'ELVANTO_CSV',
        fileName: 'inject.csv',
        // Zeile ohne gültige Mailadresse -> landet als Fehlerzeile im Report
        content: `firstName,lastName,email\n${formula},Test,keine-mail\n`,
      },
    });
    expect(create.statusCode).toBe(201);
    const jobId = create.json().id;

    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/import/${jobId}/mapping`,
      headers: { cookie: adminCookie },
      payload: { mapping: { firstName: 'firstName', lastName: 'lastName', email: 'email' } },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${jobId}/dry-run`,
      headers: { cookie: adminCookie },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${jobId}/confirm`,
      headers: { cookie: adminCookie },
    });

    const report = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/import/${jobId}/errors.csv`,
      headers: { cookie: adminCookie },
    });
    expect(report.statusCode).toBe(200);
    // Der Wert bleibt lesbar, wird aber durch das vorangestellte
    // Anführungszeichen von Excel & Co. als Text behandelt.
    expect(report.body).toContain(`'${formula}`);
    // Keine Zelle darf mehr mit einem Formelzeichen beginnen.
    for (const line of report.body.split('\n')) {
      expect(line).not.toMatch(/(^|,)"?[=+@]/);
    }
  });

  // --- SF-19/SF-20: iCal-Feed ------------------------------------
  it('der iCal-Feed lässt keine Zeilen-Injektion zu und faltet lange Zeilen', async () => {
    const { createHash } = await import('node:crypto');
    const team = await prisma.team.create({ data: { name: `${uniq}-team` } });
    const position = await prisma.position.create({ data: { teamId: team.id, name: 'Gitarre' } });

    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const event = await prisma.event.create({
      data: {
        title: 'iCal-Test',
        startsAt,
        endsAt,
        status: 'PUBLISHED',
        // Einzelnes CR ohne LF: genau der Fall, den escapeIcs vorher
        // durchgereicht hat. Dazu ein sehr langer Wert für die Faltung.
        location: `Saal\rX-INJECTED:ja und ${'sehr-langer-ortsname-'.repeat(6)}`,
      },
    });
    const slot = await prisma.eventPositionSlot.create({
      data: { eventId: event.id, positionId: position.id, requiredCount: 1 },
    });
    await prisma.assignment.create({
      data: { slotId: slot.id, personId, status: 'ACCEPTED' },
    });

    const feedToken = 'ical-feed-token-fuer-den-security-test';
    await prisma.calendarFeedToken.create({
      data: { personId, tokenHash: createHash('sha256').update(feedToken).digest('hex') },
    });

    const response = await app.inject({ method: 'GET', url: `/api/v1/ical/${feedToken}` });
    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('BEGIN:VEVENT'); // sonst wäre "nichts gefunden" wertlos

    // Kein rohes CR ausserhalb der CRLF-Zeilenenden …
    expect(body).not.toMatch(/\r(?!\n)/);
    // … und dadurch auch keine eingeschleuste Property am Zeilenanfang.
    expect(body).not.toMatch(/^X-INJECTED:/m);

    // RFC 5545: keine Zeile über 75 Oktett.
    for (const line of body.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }

    await prisma.assignment.deleteMany({ where: { personId } });
    await prisma.calendarFeedToken.deleteMany({ where: { personId } });
    await prisma.event.deleteMany({ where: { id: event.id } });
    await prisma.team.deleteMany({ where: { id: team.id } });
  });

  // --- SF-16: Ungültige Datumsparameter ---------------------------
  it('unparsbare Datumsparameter liefern 400 statt 500', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events?from=keinDatum&to=auchNicht',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(400);
  });
});
