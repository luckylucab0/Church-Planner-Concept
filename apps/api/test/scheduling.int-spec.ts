// Integrationstests für Gottesdienst-Typen, RRULE-Generierung und die
// Sichtbarkeit von Terminen (Mitglieder sehen nur Veröffentlichtes).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import {
  createTestApp,
  sessionCookieFrom,
  testPrisma as prisma,
  waitForAuditEntry,
} from './utils/create-test-app';

const uniq = `sched-${Date.now()}`;
const password = 'test-passwort-123!';

describe('Scheduling API (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let memberCookie: string;
  let deputyCookie: string;
  let leaderCookie: string;
  let teamId: string;
  let positionId: string;
  let serviceTypeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const personIds: Record<string, string> = {};
    for (const [label, role] of [
      ['Admin', 'ADMIN'],
      ['Member', 'MEMBER'],
      // Deputy und Leader sind global gewöhnliche Mitglieder – ihre Rechte
      // kommen ausschliesslich aus der Teamrolle bzw. der Rechtematrix
      ['Deputy', 'MEMBER'],
      ['Leader', 'MEMBER'],
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
      personIds[label] = person.id;
    }
    const team = await prisma.team.create({
      data: {
        name: `Team-${uniq}`,
        positions: { create: [{ name: 'Ton' }] },
        memberships: {
          create: [
            { personId: personIds.Deputy, role: 'DEPUTY' },
            { personId: personIds.Leader, role: 'LEADER' },
          ],
        },
      },
      include: { positions: true },
    });
    teamId = team.id;
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
    deputyCookie = await loginAs('deputy');
    leaderCookie = await loginAs('leader');
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

  // ---- Recht „Termine verwalten" (MANAGE_EVENTS) -----------------------

  const futureEvent = (offsetDays = 30) => ({
    title: `Termin-${uniq}`,
    startsAt: new Date(Date.now() + offsetDays * 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + offsetDays * 86_400_000 + 90 * 60_000).toISOString(),
  });

  const setCapability = (allowed: boolean) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/permissions`,
      headers: { cookie: adminCookie },
      payload: { entries: [{ role: 'DEPUTY', capability: 'MANAGE_EVENTS', allowed }] },
    });

  it('MEMBER darf Termine weder ändern noch die Positionen anpassen (403)', async () => {
    const event = await prisma.event.findFirstOrThrow({ where: { serviceTypeId } });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: memberCookie },
      payload: { title: 'Hack' },
    });
    expect(patch.statusCode).toBe(403);

    const slots = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}/slots`,
      headers: { cookie: memberCookie },
      payload: { items: [] },
    });
    expect(slots.statusCode).toBe(403);
  });

  it('DEPUTY darf ohne Häkchen keine Termine anlegen (Opt-in-Default)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: deputyCookie },
      payload: futureEvent(),
    });
    expect(response.statusCode).toBe(403);
  });

  it('LEADER darf Termine anlegen – implizites Teamleiter-Recht', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: leaderCookie },
      payload: futureEvent(31),
    });
    expect(response.statusCode).toBe(201);
  });

  it('mit Häkchen legt DEPUTY an, sieht den eigenen Entwurf und veröffentlicht ihn', async () => {
    expect((await setCapability(true)).statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: deputyCookie },
      payload: futureEvent(32),
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id;
    expect(created.json().status).toBe('PLANNED');

    // Regressionsschutz: ohne MANAGE_EVENTS in visibleStatuses wäre der
    // gerade angelegte Entwurf für die anlegende Person sofort unsichtbar
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: deputyCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().canManageEvent).toBe(true);

    const publish = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: deputyCookie },
      payload: { status: 'PUBLISHED' },
    });
    expect(publish.statusCode).toBe(200);

    // Absagen ist der Ersatz fürs Löschen und muss erlaubt sein
    const cancel = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: deputyCookie },
      payload: { status: 'CANCELLED' },
    });
    expect(cancel.statusCode).toBe(200);
  });

  it('MANAGE_EVENTS deckt weder Serien-Konfiguration noch Löschen ab (403)', async () => {
    await setCapability(true);
    const event = await prisma.event.findFirstOrThrow({ where: { serviceTypeId } });

    const type = await app.inject({
      method: 'POST',
      url: '/api/v1/service-types',
      headers: { cookie: deputyCookie },
      payload: { name: `Fremd-${uniq}` },
    });
    expect(type.statusCode).toBe(403);

    const template = await app.inject({
      method: 'PUT',
      url: `/api/v1/service-types/${serviceTypeId}/template`,
      headers: { cookie: deputyCookie },
      payload: { items: [] },
    });
    expect(template.statusCode).toBe(403);

    const generate = await app.inject({
      method: 'POST',
      url: `/api/v1/service-types/${serviceTypeId}/generate`,
      headers: { cookie: deputyCookie },
      payload: { until: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    });
    expect(generate.statusCode).toBe(403);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: deputyCookie },
    });
    expect(remove.statusCode).toBe(403);
  });

  it('lehnt Termine ab, die vor ihrem Beginn enden (400)', async () => {
    const startsAt = new Date(Date.now() + 40 * 86_400_000).toISOString();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { title: `Rückwärts-${uniq}`, startsAt, endsAt: startsAt },
    });
    expect(create.statusCode).toBe(400);

    // Auch das Teil-Update wird gegen den gespeicherten Gegenwert geprüft
    const event = await prisma.event.findFirstOrThrow({ where: { serviceTypeId } });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: adminCookie },
      payload: { startsAt: new Date(event.endsAt.getTime() + 3_600_000).toISOString() },
    });
    expect(patch.statusCode).toBe(400);
  });

  it('weist ein Umhängen an einen anderen Typ per PATCH ab (400)', async () => {
    const event = await prisma.event.findFirstOrThrow({ where: { serviceTypeId } });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}`,
      headers: { cookie: adminCookie },
      payload: { serviceTypeId: null },
    });
    expect(response.statusCode).toBe(400);
  });

  it('entfernt besetzte Positionen erst nach Bestätigung (409 → force)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { ...futureEvent(45), serviceTypeId },
    });
    const eventId = created.json().id;
    const slot = await prisma.eventPositionSlot.findFirstOrThrow({ where: { eventId } });
    const member = await prisma.person.findFirstOrThrow({
      where: { lastName: uniq, firstName: 'Member' },
    });
    await prisma.assignment.create({
      data: { slotId: slot.id, personId: member.id, status: 'ACCEPTED' },
    });

    const blocked = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/slots`,
      headers: { cookie: adminCookie },
      payload: { items: [] },
    });
    expect(blocked.statusCode).toBe(409);
    // Die Einteilung ist noch da – nichts wurde stillschweigend gelöscht
    expect(await prisma.assignment.count({ where: { slotId: slot.id } })).toBe(1);

    const forced = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/slots`,
      headers: { cookie: adminCookie },
      payload: { items: [], force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(await prisma.eventPositionSlot.count({ where: { eventId } })).toBe(0);

    // und schreibt einen Audit-Eintrag – bis hierher fehlte er ganz.
    // waitForAuditEntry statt findFirst: Der Eintrag wird fire-and-forget
    // geschrieben und ist beim Eintreffen der Antwort evtl. noch nicht da.
    const audit = await waitForAuditEntry({
      entityType: 'Event',
      entityId: eventId,
      action: 'UPDATE',
    });
    expect(audit.changedFields).toContain('slots');
  });

  it('meldet das Recht in der Session (canManageEvents)', async () => {
    await setCapability(false);
    const asMember = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: memberCookie },
    });
    expect(asMember.json().canManageEvents).toBe(false);

    const asAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: adminCookie },
    });
    expect(asAdmin.json().canManageEvents).toBe(true);

    await setCapability(true);
    const asDeputy = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: deputyCookie },
    });
    expect(asDeputy.json().canManageEvents).toBe(true);
  });
});
