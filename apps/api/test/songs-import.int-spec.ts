// Integrationstest Song-Datei-Import (ChordPro/SongSelect-Text) und
// CCLI-Nutzungsbericht inkl. Lizenznummer-Verwaltung.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `songimport-${Date.now()}`;
const password = 'test-passwort-123!';

const CHORDPRO = [
  `{title: Testlied ${uniq}}`,
  '{artist: Test Autorin}',
  '{key: G}',
  '{tempo: 128}',
  '{ccli: 7654321}',
  '{copyright: © 2026 Test Music}',
  '',
  '[G]Erste [C]Zeile',
].join('\n');

const SONGSELECT_TXT = [
  `Zweites Lied ${uniq}`,
  'Zweiter Autor',
  '',
  'Verse 1',
  'Eine Textzeile',
  '',
  'CCLI Song # 1112223',
  '© 2026 Andere Musik',
  'For use solely with the SongSelect® Terms of Use. All rights reserved.',
].join('\n');

describe('Song-Import & CCLI-Bericht (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let memberCookie: string;

  async function createPerson(label: string, role: 'ADMIN' | 'MEMBER') {
    await prisma.person.create({
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
  }

  async function loginCookie(label: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-${label.toLowerCase()}@test.local`, password },
    });
    return sessionCookieFrom(response.headers['set-cookie']);
  }

  function importFile(cookie: string, content: string, filename: string, overwrite?: boolean) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/songs/import',
      headers: { cookie },
      payload: { content, filename, ...(overwrite === undefined ? {} : { overwrite }) },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await createPerson('Admin', 'ADMIN');
    await createPerson('Member', 'MEMBER');
    adminCookie = await loginCookie('Admin');
    memberCookie = await loginCookie('Member');
  });

  afterAll(async () => {
    await prisma.song.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('ohne MANAGE_SONGS kein Import, kein Bericht (403)', async () => {
    const imported = await importFile(memberCookie, CHORDPRO, 'test.cho');
    expect(imported.statusCode).toBe(403);

    const report = await app.inject({
      method: 'GET',
      url: '/api/v1/songs/ccli-report?from=2026-01-01&to=2026-12-31',
      headers: { cookie: memberCookie },
    });
    expect(report.statusCode).toBe(403);
  });

  it('ChordPro-Import übernimmt alle Felder', async () => {
    const response = await importFile(adminCookie, CHORDPRO, `testlied-${uniq}.cho`);
    expect(response.statusCode).toBe(201);
    const { created, song } = response.json();
    expect(created).toBe(true);
    expect(song).toMatchObject({
      title: `Testlied ${uniq}`,
      defaultKey: 'G',
      tempoBpm: 128,
      ccliNumber: '7654321',
      author: 'Test Autorin',
      copyright: '© 2026 Test Music',
    });
    expect(song.lyrics).toContain('[G]Erste [C]Zeile');
  });

  it('SongSelect-Text-Import + Duplikat-Handling (409, dann overwrite)', async () => {
    const first = await importFile(adminCookie, SONGSELECT_TXT, 'zweites-lied.txt');
    expect(first.statusCode).toBe(201);
    const songId = first.json().song.id;

    const duplicate = await importFile(adminCookie, SONGSELECT_TXT, 'zweites-lied.txt');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'DUPLICATE_CCLI', songId });

    const overwrite = await importFile(
      adminCookie,
      SONGSELECT_TXT.replace('Eine Textzeile', 'Korrigierte Zeile'),
      'zweites-lied.txt',
      true,
    );
    expect(overwrite.statusCode).toBe(201);
    expect(overwrite.json().created).toBe(false);
    expect(overwrite.json().song.id).toBe(songId);
    expect(overwrite.json().song.lyrics).toContain('Korrigierte Zeile');

    const count = await prisma.song.count({ where: { ccliNumber: '1112223' } });
    expect(count).toBe(1);
  });

  it('unlesbare Datei gibt 400', async () => {
    const response = await importFile(adminCookie, '\n \n', 'leer.txt');
    expect(response.statusCode).toBe(400);
  });

  it('CCLI-Bericht zählt pro Lied und Termin, ohne abgesagte Termine', async () => {
    const song = await prisma.song.findFirstOrThrow({ where: { ccliNumber: '7654321' } });

    async function eventWithSong(
      title: string,
      startsAt: Date,
      status: 'PUBLISHED' | 'CANCELLED',
      songUses: number,
    ) {
      await prisma.event.create({
        data: {
          title: `${title}-${uniq}`,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 90 * 60_000),
          status,
          planItems: {
            create: Array.from({ length: songUses }, (_, i) => ({
              sortOrder: i,
              title: 'Lobpreis',
              songId: song.id,
            })),
          },
        },
      });
    }

    // Im Zeitraum: ein Termin mit dem Lied ZWEIMAL im Plan (zählt 1),
    // ein zweiter Termin (zählt 1), ein abgesagter (zählt nicht),
    // einer außerhalb des Zeitraums (zählt nicht).
    await eventWithSong('GD-A', new Date('2026-03-01T10:00:00Z'), 'PUBLISHED', 2);
    await eventWithSong('GD-B', new Date('2026-03-08T10:00:00Z'), 'PUBLISHED', 1);
    await eventWithSong('GD-C', new Date('2026-03-15T10:00:00Z'), 'CANCELLED', 1);
    await eventWithSong('GD-D', new Date('2026-06-01T10:00:00Z'), 'PUBLISHED', 1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/songs/ccli-report?from=2026-02-01&to=2026-03-31',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json();
    const row = report.rows.find((r: { ccliNumber: string | null }) => r.ccliNumber === '7654321');
    expect(row).toMatchObject({ title: `Testlied ${uniq}`, count: 2 });
  });

  it('Lizenznummer: nur Admin darf setzen, erscheint im Bericht', async () => {
    const asMember = await app.inject({
      method: 'PUT',
      url: '/api/v1/songs/ccli-license',
      headers: { cookie: memberCookie },
      payload: { licenseNumber: '999999' },
    });
    expect(asMember.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: 'PUT',
      url: '/api/v1/songs/ccli-license',
      headers: { cookie: adminCookie },
      payload: { licenseNumber: '424242' },
    });
    expect(asAdmin.statusCode).toBe(200);

    const report = await app.inject({
      method: 'GET',
      url: '/api/v1/songs/ccli-report?from=2026-01-01&to=2026-01-31',
      headers: { cookie: adminCookie },
    });
    expect(report.json().licenseNumber).toBe('424242');
  });
});
