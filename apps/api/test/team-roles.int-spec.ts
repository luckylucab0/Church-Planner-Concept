// Integrationstests für Teamrollen + Rechtematrix: Rollen vergeben
// (LEADER nur durch Admin), Matrix lesen/schreiben (nur Admin/Leiter)
// und die WIRKUNG der Matrix über die echten Endpoints (Einteilen,
// Freigeben, Entwurfs-Sichtbarkeit).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `roles-${Date.now()}`;
const password = 'test-passwort-123!';

describe('Teamrollen & Rechtematrix (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let leaderCookie: string;
  let deputyCookie: string;
  let memberCookie: string;
  let teamId: string;
  let deputyId: string;
  let memberId: string;
  let leaderId: string;
  let slotId: string;
  let draftEventId: string;

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

  async function login(label: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-${label.toLowerCase()}@test.local`, password },
    });
    return sessionCookieFrom(response.headers['set-cookie']);
  }

  beforeAll(async () => {
    app = await createTestApp();
    await createPerson('Admin', 'ADMIN');
    leaderId = await createPerson('Leader');
    deputyId = await createPerson('Deputy');
    memberId = await createPerson('Member');

    const team = await prisma.team.create({
      data: {
        name: `Team-${uniq}`,
        positions: { create: [{ name: 'Ton' }] },
        memberships: {
          create: [
            { personId: leaderId, role: 'LEADER' },
            { personId: deputyId }, // Rolle kommt gleich per API
            { personId: memberId },
          ],
        },
      },
      include: { positions: true },
    });
    teamId = team.id;
    await prisma.positionSkill.create({
      data: { positionId: team.positions[0].id, personId: memberId, skillLevel: 'SOLID' },
    });

    const event = await prisma.event.create({
      data: {
        title: `Dienst-${uniq}`,
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000 + 90 * 60_000),
        status: 'PUBLISHED',
        slots: { create: [{ positionId: team.positions[0].id, requiredCount: 2 }] },
      },
      include: { slots: true },
    });
    slotId = event.slots[0].id;

    const draft = await prisma.event.create({
      data: {
        title: `Entwurf-${uniq}`,
        startsAt: new Date(Date.now() + 21 * 86_400_000),
        endsAt: new Date(Date.now() + 21 * 86_400_000 + 90 * 60_000),
        status: 'PLANNED',
      },
    });
    draftEventId = draft.id;

    adminCookie = await login('Admin');
    leaderCookie = await login('Leader');
    deputyCookie = await login('Deputy');
    memberCookie = await login('Member');
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { title: { contains: uniq } } });
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('LEADER vergibt die Rolle Stellvertretung (DEPUTY)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/${teamId}/members/${deputyId}`,
      headers: { cookie: leaderCookie },
      payload: { role: 'DEPUTY' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('DEPUTY');
  });

  it('LEADER darf die Rolle LEADER weder vergeben noch entziehen (403)', async () => {
    const grant = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/${teamId}/members/${memberId}`,
      headers: { cookie: leaderCookie },
      payload: { role: 'LEADER' },
    });
    expect(grant.statusCode).toBe(403);

    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/${teamId}/members/${leaderId}`,
      headers: { cookie: leaderCookie },
      payload: { role: 'MEMBER' },
    });
    expect(demote.statusCode).toBe(403);
  });

  it('DEPUTY darf einteilen (Default ASSIGN), aber keine Mitglieder verwalten', async () => {
    const assign = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: deputyCookie },
      payload: { slotId, personId: memberId },
    });
    expect(assign.statusCode).toBe(201);

    const addMember = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/members`,
      headers: { cookie: deputyCookie },
      payload: { personId: leaderId },
    });
    expect(addMember.statusCode).toBe(403);
  });

  it('DEPUTY sieht Entwurfs-Termine (VIEW_DRAFTS), MEMBER nicht', async () => {
    const asDeputy = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}`,
      headers: { cookie: deputyCookie },
    });
    expect(asDeputy.statusCode).toBe(200);

    const asMember = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}`,
      headers: { cookie: memberCookie },
    });
    expect(asMember.statusCode).toBe(404);
  });

  it('Rechtematrix lesen: nur Admin oder LEADER (DEPUTY/MEMBER 403)', async () => {
    const asLeader = await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/permissions`,
      headers: { cookie: leaderCookie },
    });
    expect(asLeader.statusCode).toBe(200);
    // Gemergte Sicht enthält die Defaults
    expect(asLeader.json().entries.DEPUTY.ASSIGN).toBe(true);
    expect(asLeader.json().entries.MEMBER.ASSIGN).toBe(false);

    for (const cookie of [deputyCookie, memberCookie]) {
      const denied = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}/permissions`,
        headers: { cookie },
      });
      expect(denied.statusCode).toBe(403);
    }
  });

  it('Matrix-Änderung wirkt sofort: DEPUTY verliert ASSIGN', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/permissions`,
      headers: { cookie: leaderCookie },
      payload: { entries: [{ role: 'DEPUTY', capability: 'ASSIGN', allowed: false }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().entries.DEPUTY.ASSIGN).toBe(false);

    const assign = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: deputyCookie },
      payload: { slotId, personId: memberId },
    });
    expect(assign.statusCode).toBe(403);
  });

  it('Matrix kann Rechte auch ERWEITERN: MEMBER darf Slots freigeben', async () => {
    const before = await app.inject({
      method: 'PATCH',
      url: `/api/v1/signup/slots/${slotId}`,
      headers: { cookie: memberCookie },
      payload: { open: true },
    });
    expect(before.statusCode).toBe(403);

    await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/permissions`,
      headers: { cookie: leaderCookie },
      payload: { entries: [{ role: 'MEMBER', capability: 'OPEN_SIGNUP', allowed: true }] },
    });

    const after = await app.inject({
      method: 'PATCH',
      url: `/api/v1/signup/slots/${slotId}`,
      headers: { cookie: memberCookie },
      payload: { open: true },
    });
    expect(after.statusCode).toBe(200);
  });

  it('LEADER ist in der Matrix nicht konfigurierbar (400)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/permissions`,
      headers: { cookie: leaderCookie },
      payload: { entries: [{ role: 'LEADER', capability: 'ASSIGN', allowed: false }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('ADMIN vergibt und entzieht die Rolle LEADER', async () => {
    const grant = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/${teamId}/members/${memberId}`,
      headers: { cookie: adminCookie },
      payload: { role: 'LEADER' },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().role).toBe('LEADER');

    const revoke = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/${teamId}/members/${memberId}`,
      headers: { cookie: adminCookie },
      payload: { role: 'MEMBER' },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().role).toBe('MEMBER');
  });
});
