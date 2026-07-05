// Tests für Verfügbarkeit: Self-Service-CRUD und die Kernlogik der
// Verfügbarkeitsprüfung (einmalig + wiederkehrend per RRULE).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { AvailabilityService } from '../src/availability/availability.service';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `avail-${Date.now()}`;
const password = 'test-passwort-123!';

describe('Availability (integration)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  let personId: string;
  let otherId: string;
  let availability: AvailabilityService;

  beforeAll(async () => {
    app = await createTestApp();
    availability = app.get(AvailabilityService);

    const person = await prisma.person.create({
      data: {
        firstName: 'Avail',
        lastName: uniq,
        email: `${uniq}-avail@test.local`,
        account: {
          create: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
        },
      },
    });
    personId = person.id;
    const other = await prisma.person.create({
      data: { firstName: 'Other', lastName: uniq },
    });
    otherId = other.id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-avail@test.local`, password },
    });
    cookie = sessionCookieFrom(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('legt Abwesenheiten an und lehnt verdrehte Zeiträume ab', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/me/absences',
      headers: { cookie },
      payload: { fromDate: '2026-08-15', toDate: '2026-08-01' },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/me/absences',
      headers: { cookie },
      payload: { fromDate: '2026-08-01', toDate: '2026-08-15', reason: 'Ferien' },
    });
    expect(good.statusCode).toBe(201);
  });

  it('Abwesenheit blockiert genau den Zeitraum', async () => {
    expect(await availability.isUnavailable(personId, new Date('2026-08-07T10:00:00'))).toBe(true);
    expect(await availability.isUnavailable(personId, new Date('2026-08-20T10:00:00'))).toBe(false);
  });

  it('wiederkehrende Regel: jeden 1. Sonntag im Monat', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/recurring-unavailabilities',
      headers: { cookie },
      payload: { rrule: 'FREQ=MONTHLY;BYDAY=1SU', note: '1. Sonntag nie' },
    });
    expect(create.statusCode).toBe(201);

    // 6. Sept 2026 ist der erste Sonntag im September → blockiert
    expect(await availability.isUnavailable(personId, new Date('2026-09-06T10:00:00'))).toBe(true);
    // 13. Sept 2026 (zweiter Sonntag) → frei
    expect(await availability.isUnavailable(personId, new Date('2026-09-13T10:00:00'))).toBe(false);
  });

  it('lehnt kaputte RRULEs ab (400)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/recurring-unavailabilities',
      headers: { cookie },
      payload: { rrule: 'FREQ=KAPUTT' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('löscht nur EIGENE Einträge (IDOR-Schutz)', async () => {
    // Abwesenheit einer anderen Person
    const foreign = await prisma.absence.create({
      data: {
        personId: otherId,
        fromDate: new Date('2026-10-01'),
        toDate: new Date('2026-10-05'),
      },
    });
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/absences/${foreign.id}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(204); // idempotent, aber…
    // …der fremde Eintrag existiert noch
    expect(await prisma.absence.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });
});
