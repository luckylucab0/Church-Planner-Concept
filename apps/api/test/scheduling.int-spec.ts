// Integrationstests für Gottesdienst-Typen, RRULE-Generierung und die
// Sichtbarkeit von Terminen (Mitglieder sehen nur Veröffentlichtes).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `sched-${Date.now()}`;
const password = 'test-passwort-123!';

describe('Scheduling API (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let memberCookie: string;
  let positionId: string;
  let serviceTypeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    for (const [label, role] of [
      ['Admin', 'ADMIN'],
      ['Member', 'MEMBER'],
    ] as const) {
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
    const team = await prisma.team.create({
      data: { name: `Team-${uniq}`, positions: { create: [{ name: 'Ton' }] } },
      include: { positions: true },
    });
    positionId = team.positions[0].id;

    const loginAs = async (label: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: `${uniq}-${label}@test.local`, password },
      });
      return sessionCookieFrom(response.headers['set-cookie']);
    };
    adminCookie = await loginAs('admin');
    memberCookie = await loginAs('member');
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.serviceType.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('MEMBER darf keine Typen/Termine anlegen (403)', async () => {
    const type = await app.inject({
      method: 'POST',
      url: '/api/v1/service-types',
      headers: { cookie: memberCookie },
      payload: { name: 'Hack' },
    });
    expect(type.statusCode).toBe(403);

    const event = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: memberCookie },
      payload: {
        title: 'Hack',
        startsAt: new Date().toISOString(),
        endsAt: new Date().toISOString(),
      },
    });
    expect(event.statusCode).toBe(403);
  });

  it('ADMIN legt Typ mit RRULE und Template an', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/service-types',
      headers: { cookie: adminCookie },
      payload: {
        name: `Gottesdienst-${uniq}`,
        rrule: 'FREQ=WEEKLY;BYDAY=SU',
        startTime: '10:00',
        durationMinutes: 90,
      },
    });
    expect(create.statusCode).toBe(201);
    serviceTypeId = create.json().id;

    const template = await app.inject({
      method: 'PUT',
      url: `/api/v1/service-types/${serviceTypeId}/template`,
      headers: { cookie: adminCookie },
      payload: { items: [{ positionId, requiredCount: 2 }] },
    });
    expect(template.statusCode).toBe(200);
  });

  it('lehnt ungültige RRULEs ab (400)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/service-types',
      headers: { cookie: adminCookie },
      payload: { name: `Kaputt-${uniq}`, rrule: 'FREQ=QUATSCH' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('generiert Termine aus der RRULE – idempotent', async () => {
    const until = new Date(Date.now() + 28 * 86_400_000).toISOString();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/service-types/${serviceTypeId}/generate`,
      headers: { cookie: adminCookie },
      payload: { until },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().created).toBeGreaterThanOrEqual(3); // ~4 Sonntage in 28 Tagen

    // Zweiter Lauf: nichts Neues – bestehende Termine werden erkannt
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/service-types/${serviceTypeId}/generate`,
      headers: { cookie: adminCookie },
      payload: { until },
    });
    expect(second.json().created).toBe(0);

    // Slots kommen aus dem Template
    const event = await prisma.event.findFirstOrThrow({
      where: { serviceTypeId },
      include: { slots: true },
    });
    expect(event.slots).toHaveLength(1);
    expect(event.slots[0].requiredCount).toBe(2);
  });

  it('MEMBER sieht nur veröffentlichte Termine', async () => {
    const event = await prisma.event.findFirstOrThrow({ where: { serviceTypeId } });
    // Auf Entwurf zurückstellen
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: adminCookie },
      payload: { status: 'PLANNED' },
    });

    const asMember = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: memberCookie },
    });
    expect(asMember.statusCode).toBe(404); // für Mitglieder unsichtbar

    const asAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: adminCookie },
    });
    expect(asAdmin.statusCode).toBe(200);

    // Wieder veröffentlichen → sichtbar inkl. Slot-Struktur
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: adminCookie },
      payload: { status: 'PUBLISHED' },
    });
    const published = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: memberCookie },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().slots[0].position.name).toBe('Ton');
    expect(published.json().slots[0].canAssign).toBe(false);
  });
});
