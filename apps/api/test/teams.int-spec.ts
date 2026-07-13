// Negativtests für Team-Verwaltung: Teamleiter-Scope ist strikt auf das
// eigene Team begrenzt; die Rolle LEADER kann nur ein Admin vergeben.
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `teams-${Date.now()}`;
const password = 'test-passwort-123!';

describe('Teams API – Berechtigungen (integration)', () => {
  let app: NestFastifyApplication;
  let adminCookie: string;
  let leaderCookie: string;
  let memberCookie: string;
  let teamAId: string;
  let teamBId: string;
  let positionId: string;
  let memberId: string;
  let looseId: string; // Person ohne Team

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
    const adminId = await createPerson('Admin', 'ADMIN');
    const leaderId = await createPerson('Leader');
    memberId = await createPerson('Member');
    looseId = await createPerson('Loose');
    void adminId;

    const teamA = await prisma.team.create({
      data: {
        name: `Team-A-${uniq}`,
        positions: { create: [{ name: 'Gitarre' }] },
        memberships: {
          create: [{ personId: leaderId, role: 'LEADER' }, { personId: memberId }],
        },
      },
      include: { positions: true },
    });
    teamAId = teamA.id;
    positionId = teamA.positions[0].id;
    const teamB = await prisma.team.create({ data: { name: `Team-B-${uniq}` } });
    teamBId = teamB.id;

    adminCookie = await login('Admin');
    leaderCookie = await login('Leader');
    memberCookie = await login('Member');
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  it('MEMBER darf keine Teams anlegen/ändern/löschen (403)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: { cookie: memberCookie },
      payload: { name: 'Hacker-Team' },
    });
    expect(create.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/teams/${teamAId}`,
      headers: { cookie: memberCookie },
    });
    expect(del.statusCode).toBe(403);
  });

  it('MEMBER darf keine Mitglieder hinzufügen (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamAId}/members`,
      headers: { cookie: memberCookie },
      payload: { personId: looseId },
    });
    expect(response.statusCode).toBe(403);
  });

  it('LEADER kann Mitglieder im EIGENEN Team verwalten', async () => {
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamAId}/members`,
      headers: { cookie: leaderCookie },
      payload: { personId: looseId },
    });
    expect(add.statusCode).toBe(201);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/teams/${teamAId}/members/${looseId}`,
      headers: { cookie: leaderCookie },
    });
    expect(remove.statusCode).toBe(204);
  });

  it('LEADER darf im FREMDEN Team nichts verwalten (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamBId}/members`,
      headers: { cookie: leaderCookie },
      payload: { personId: looseId },
    });
    expect(response.statusCode).toBe(403);
  });

  it('LEADER darf das Leader-Flag NICHT vergeben (Privilege Escalation)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamAId}/members`,
      headers: { cookie: leaderCookie },
      payload: { personId: looseId, role: 'LEADER' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('LEADER kann Skills im eigenen Team pflegen', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/positions/${positionId}/skills/${memberId}`,
      headers: { cookie: leaderCookie },
      payload: { skillLevel: 'EXPERT' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().skillLevel).toBe('EXPERT');
  });

  it('Skills nur für Team-Mitglieder (Person ohne Team → 403)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/positions/${positionId}/skills/${looseId}`,
      headers: { cookie: leaderCookie },
      payload: { skillLevel: 'SOLID' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('ADMIN kann Teams anlegen und Leader-Flag vergeben', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: { cookie: adminCookie },
      payload: { name: `Team-C-${uniq}`, color: '#22c55e' },
    });
    expect(create.statusCode).toBe(201);

    const addLeader = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${create.json().id}/members`,
      headers: { cookie: adminCookie },
      payload: { personId: looseId, role: 'LEADER' },
    });
    expect(addLeader.statusCode).toBe(201);
    expect(addLeader.json().role).toBe('LEADER');
  });

  it('Team-Detail filtert Kontaktdaten der Mitglieder je nach Betrachter', async () => {
    const asMember = await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamAId}`,
      headers: { cookie: memberCookie },
    });
    const leaderEntry = (asMember.json().members as Record<string, unknown>[]).find(
      (m) => m.firstName === 'Leader',
    );
    expect(leaderEntry).toBeDefined();
    expect(leaderEntry).not.toHaveProperty('email');

    const asLeader = await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamAId}`,
      headers: { cookie: leaderCookie },
    });
    const memberEntry = (asLeader.json().members as Record<string, unknown>[]).find(
      (m) => m.firstName === 'Member',
    );
    expect(memberEntry).toHaveProperty('email');
  });
});
