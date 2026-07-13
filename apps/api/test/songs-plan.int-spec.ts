// Integrationstests für Liederdatenbank und Gottesdienst-Ablaufplan:
// Schreibrechte (Admin/Teamleiter ja, Mitglied nein), Arrangement-Bindung
// ans Lied und das transaktionale Ersetzen des Ablaufs (Reorder).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `plan-${Date.now()}`;
const password = 'test-passwort-123!';

describe('Songs & Ablaufplan API (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let leaderCookie: string;
  let memberCookie: string;
  let eventId: string;
  let songId: string;
  let arrangementId: string;
  let leaderId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const people: Record<string, string> = {};
    for (const [label, role] of [
      ['Admin', 'ADMIN'],
      ['Leader', 'MEMBER'],
      ['Member', 'MEMBER'],
    ] as const) {
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
      people[label] = person.id;
    }
    leaderId = people.Leader;
    // Leader leitet ein Team, Member ist nur Mitglied
    await prisma.team.create({
      data: {
        name: `Team-${uniq}`,
        memberships: {
          create: [
            { personId: people.Leader, role: 'LEADER' },
            { personId: people.Member },
          ],
        },
      },
    });
    const event = await prisma.event.create({
      data: {
        title: `Gottesdienst-${uniq}`,
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000 + 90 * 60_000),
        status: 'PUBLISHED',
      },
    });
    eventId = event.id;

    const loginAs = async (label: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: `${uniq}-${label}@test.local`, password },
      });
      return sessionCookieFrom(response.headers['set-cookie']);
    };
    adminCookie = await loginAs('admin');
    leaderCookie = await loginAs('leader');
    memberCookie = await loginAs('member');
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.song.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('MEMBER darf keine Lieder anlegen (403), aber lesen', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { cookie: memberCookie },
      payload: { title: 'Hack' },
    });
    expect(create.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/songs',
      headers: { cookie: memberCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().canManage).toBe(false);
  });

  it('TEAMLEITER legt Lied mit Arrangement an', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { cookie: leaderCookie },
      payload: { title: `Lied-${uniq}`, defaultKey: 'D', tempoBpm: 72, ccliNumber: '7654321' },
    });
    expect(create.statusCode).toBe(201);
    songId = create.json().id;

    const arrangement = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${songId}/arrangements`,
      headers: { cookie: leaderCookie },
      payload: { name: 'Akustik', key: 'C' },
    });
    expect(arrangement.statusCode).toBe(201);
    arrangementId = arrangement.json().id;

    // Suche über Titel und CCLI-Nummer
    const byCcli = await app.inject({
      method: 'GET',
      url: '/api/v1/songs?query=7654321',
      headers: { cookie: leaderCookie },
    });
    expect(byCcli.json().songs).toHaveLength(1);
    expect(byCcli.json().songs[0].arrangements[0].name).toBe('Akustik');
    expect(byCcli.json().canManage).toBe(true);
  });

  it('MEMBER darf den Ablauf nicht schreiben (403)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/plan`,
      headers: { cookie: memberCookie },
      payload: { items: [{ title: 'Hack', durationMinutes: 5 }] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('TEAMLEITER setzt Ablauf mit Lied, Arrangement und Verantwortlicher', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/plan`,
      headers: { cookie: leaderCookie },
      payload: {
        items: [
          { title: 'Begrüßung', durationMinutes: 5, responsiblePersonId: leaderId },
          { title: `Lied-${uniq}`, durationMinutes: 6, songId, arrangementId },
          { title: 'Predigt', durationMinutes: 30, notes: 'Reihe Bergpredigt' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json();
    expect(items).toHaveLength(3);
    expect(items[1].song.title).toBe(`Lied-${uniq}`);
    expect(items[1].song.ccliNumber).toBe('7654321');
    expect(items[1].arrangement.key).toBe('C');
    expect(items[0].responsiblePerson.name).toBe(`Leader ${uniq}`);
  });

  it('MEMBER sieht den Ablauf im Termin-Detail (lesend, canEditPlan=false)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().canEditPlan).toBe(false);
    expect(response.json().planItems.map((i: { title: string }) => i.title)).toEqual([
      'Begrüßung',
      `Lied-${uniq}`,
      'Predigt',
    ]);
  });

  it('Reorder: erneutes PUT ersetzt den Ablauf in neuer Reihenfolge', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/plan`,
      headers: { cookie: adminCookie },
      payload: {
        items: [
          { title: 'Predigt', durationMinutes: 30 },
          { title: 'Begrüßung', durationMinutes: 5 },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((i: { title: string }) => i.title)).toEqual([
      'Predigt',
      'Begrüßung',
    ]);
  });

  it('lehnt Arrangement ab, das nicht zum Lied gehört (400)', async () => {
    const otherSong = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { cookie: adminCookie },
      payload: { title: `Anderes-Lied-${uniq}` },
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/plan`,
      headers: { cookie: adminCookie },
      payload: {
        items: [{ title: 'Lied', durationMinutes: 5, songId: otherSong.json().id, arrangementId }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('Lied löschen löst die Referenz, der Ablaufpunkt bleibt', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/plan`,
      headers: { cookie: adminCookie },
      payload: { items: [{ title: 'Lobpreis', durationMinutes: 6, songId }] },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/songs/${songId}`,
      headers: { cookie: leaderCookie },
    });
    expect(del.statusCode).toBe(204);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().planItems[0].title).toBe('Lobpreis');
    expect(detail.json().planItems[0].song).toBeNull();
  });
});
