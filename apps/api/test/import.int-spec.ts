// Import-Pipeline end-to-end: Upload → Mapping → Dry-Run → Confirm,
// Duplikat-Erkennung (E-Mail primär, Name+Geburtstag Fallback),
// Fehlerreport und Admin-only-Zugriff.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `import-${Date.now()}`;
const password = 'test-passwort-123!';

const ELVANTO_CSV = [
  'First Name,Last Name,Email,Mobile,Date of Birth,Groups,Lieblingsfarbe',
  `Anna,${uniq},anna-${uniq}@test.local,+41791112233,01.05.1990,"Worship-${uniq};Technik-${uniq}",Blau`,
  `Ben,${uniq},,,"",Worship-${uniq},Rot`,
  `Clara,${uniq},keine-mail,,,,`, // ungültige E-Mail → ERROR
  `,${uniq},ohne-vorname-${uniq}@test.local,,,,`, // kein Vorname → SKIPPED
].join('\n');

describe('Import API (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let memberCookie: string;
  let jobId: string;

  beforeAll(async () => {
    app = await createTestApp();
    for (const [label, role] of [
      ['Admin', 'ADMIN'],
      ['Member', 'MEMBER'],
    ] as const) {
      await prisma.person.create({
        data: {
          firstName: label,
          lastName: `fixture-${uniq}`,
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
    const login = async (label: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: `${uniq}-${label}@test.local`, password },
      });
      return sessionCookieFrom(response.headers['set-cookie']);
    };
    adminCookie = await login('admin');
    memberCookie = await login('member');
  });

  afterAll(async () => {
    await prisma.importJob.deleteMany({ where: { fileName: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({
      where: { OR: [{ lastName: uniq }, { lastName: `fixture-${uniq}` }] },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('MEMBER hat keinen Zugriff auf den Import (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/import',
      headers: { cookie: memberCookie },
      payload: { source: 'ELVANTO_CSV', fileName: `${uniq}.csv`, content: ELVANTO_CSV },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Upload erkennt Elvanto-Spalten automatisch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/import',
      headers: { cookie: adminCookie },
      payload: { source: 'ELVANTO_CSV', fileName: `${uniq}.csv`, content: ELVANTO_CSV },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    jobId = body.id;
    expect(body.rowCount).toBe(4);
    expect(body.suggestedMapping['First Name']).toBe('firstName');
    expect(body.suggestedMapping['Groups']).toBe('teams');
    // Unbekannte Spalte → notes (nichts geht verloren)
    expect(body.suggestedMapping['Lieblingsfarbe']).toBe('notes');
  });

  it('Dry-Run liefert korrekte Vorschau ohne Datenänderung', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${jobId}/dry-run`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().summary).toMatchObject({
      CREATED: 2, // Anna + Ben
      ERROR: 1, // Clara (ungültige E-Mail)
      SKIPPED: 1, // ohne Vorname
    });
    // Noch nichts angelegt
    expect(await prisma.person.count({ where: { lastName: uniq } })).toBe(0);
  });

  it('Confirm legt Personen und Teams an; Notizen-Spalten landen in importNotes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${jobId}/confirm`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().summary.CREATED).toBe(2);

    const anna = await prisma.person.findFirstOrThrow({
      where: { firstName: 'Anna', lastName: uniq },
      include: { memberships: { include: { team: true } } },
    });
    expect(anna.email).toBe(`anna-${uniq}@test.local`);
    expect(anna.birthday?.getFullYear()).toBe(1990);
    expect(anna.importNotes).toContain('Lieblingsfarbe: Blau');
    expect(anna.memberships.map((m) => m.team.name).sort()).toEqual([
      `Technik-${uniq}`,
      `Worship-${uniq}`,
    ]);
  });

  it('Fehlerreport enthält ERROR- und SKIPPED-Zeilen als CSV', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/import/${jobId}/errors.csv`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain('Ungültige E-Mail');
    expect(response.body).toContain('Vor- oder Nachname fehlt');
  });

  it('Zweiter Import erkennt Duplikate: E-Mail-Match → UPDATED, Name+Geburtstag → MERGED', async () => {
    // Anna: gleiche E-Mail, neue Telefonnummer (Merge füllt nur Leeres)
    // Ben: keine E-Mail, aber diesmal mit Geburtstag → CREATED (kein Match möglich)
    // Anna2: gleicher Name+Geburtstag wie Anna, andere/keine E-Mail → MERGED
    const secondCsv = [
      'First Name,Last Name,Email,Date of Birth,Mobile',
      `Anna,${uniq},anna-${uniq}@test.local,,+41790000000`,
      `Anna,${uniq},,01.05.1990,`,
      `Doris,${uniq},doris-${uniq}@test.local,,`,
    ].join('\n');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/import',
      headers: { cookie: adminCookie },
      payload: { source: 'ELVANTO_CSV', fileName: `${uniq}-2.csv`, content: secondCsv },
    });
    const secondJobId = upload.json().id;

    const dryRun = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${secondJobId}/dry-run`,
      headers: { cookie: adminCookie },
    });
    expect(dryRun.json().summary).toMatchObject({ UPDATED: 1, MERGED: 1, CREATED: 1 });

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${secondJobId}/confirm`,
      headers: { cookie: adminCookie },
    });

    // Merge: bestehende Werte bleiben, Leeres wird gefüllt
    const anna = await prisma.person.findFirstOrThrow({
      where: { firstName: 'Anna', lastName: uniq },
    });
    expect(anna.phone).toBe('+41791112233'); // NICHT überschrieben
    // Kein Anna-Duplikat entstanden
    expect(await prisma.person.count({ where: { firstName: 'Anna', lastName: uniq } })).toBe(1);
  });

  it('Confirm ohne Dry-Run wird abgelehnt (400)', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/import',
      headers: { cookie: adminCookie },
      payload: {
        source: 'ELVANTO_CSV',
        fileName: `${uniq}-3.csv`,
        content: 'First Name,Last Name\nEmil,' + uniq,
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/${upload.json().id}/confirm`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(400);
  });
});
