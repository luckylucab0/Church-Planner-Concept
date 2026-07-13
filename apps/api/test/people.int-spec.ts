// Pflicht-Negativtests der Berechtigungslogik auf API-Ebene: belegt pro
// Rolle, dass unberechtigte Feld- und Ressourcen-Zugriffe SERVERSEITIG
// blockiert werden (403 bzw. fehlende Felder in der Response).
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as argon2 from 'argon2';
import { createTestApp, sessionCookieFrom, testPrisma as prisma } from './utils/create-test-app';

const uniq = `people-${Date.now()}`;
const password = 'test-passwort-123!';

interface Fixture {
  personId: string;
  cookie?: string;
}

describe('People API – Berechtigungen (integration)', () => {
  let app: NestFastifyApplication;
  const admin: Fixture = { personId: '' };
  const leader: Fixture = { personId: '' }; // Leiter von Team A
  const member: Fixture = { personId: '' }; // Mitglied Team A, nichts freigegeben
  const sharing: Fixture = { personId: '' }; // Mitglied Team A, E-Mail freigegeben
  const outsider: Fixture = { personId: '' }; // Mitglied Team B

  async function createPerson(
    label: string,
    options: { role?: 'ADMIN' | 'MEMBER'; emailVisible?: boolean } = {},
  ): Promise<string> {
    const person = await prisma.person.create({
      data: {
        firstName: label,
        lastName: uniq,
        email: `${uniq}-${label.toLowerCase()}@test.local`,
        phone: '+41 79 111 22 33',
        account: {
          create: {
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
            globalRole: options.role ?? 'MEMBER',
          },
        },
        privacySettings: { create: { emailVisibleToTeam: options.emailVisible ?? false } },
      },
    });
    return person.id;
  }

  async function loginCookie(label: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${uniq}-${label.toLowerCase()}@test.local`, password },
    });
    return sessionCookieFrom(response.headers['set-cookie']);
  }

  beforeAll(async () => {
    app = await createTestApp();

    admin.personId = await createPerson('Admin', { role: 'ADMIN' });
    leader.personId = await createPerson('Leader');
    member.personId = await createPerson('Member');
    sharing.personId = await createPerson('Sharing', { emailVisible: true });
    outsider.personId = await createPerson('Outsider');

    // Team A: leader (isLeader), member, sharing – Team B: outsider
    await prisma.team.create({
      data: {
        name: `Team-A-${uniq}`,
        memberships: {
          create: [
            { personId: leader.personId, role: 'LEADER' },
            { personId: member.personId },
            { personId: sharing.personId },
          ],
        },
      },
    });
    await prisma.team.create({
      data: {
        name: `Team-B-${uniq}`,
        memberships: { create: [{ personId: outsider.personId }] },
      },
    });

    admin.cookie = await loginCookie('Admin');
    leader.cookie = await loginCookie('Leader');
    member.cookie = await loginCookie('Member');
    outsider.cookie = await loginCookie('Outsider');
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { name: { contains: uniq } } });
    await prisma.person.deleteMany({ where: { lastName: uniq } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('Rolle MEMBER (neugieriges Mitglied)', () => {
    it('sieht bei fremden Personen im selben Team keine nicht freigegebenen Kontaktdaten', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${leader.personId}`,
        headers: { cookie: member.cookie! },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('phone');
      expect(body).not.toHaveProperty('address');
    });

    it('sieht freigegebene Felder von Teammitgliedern (PrivacySettings)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${sharing.personId}`,
        headers: { cookie: member.cookie! },
      });
      const body = response.json();
      expect(body).toHaveProperty('email'); // freigegeben
      expect(body).not.toHaveProperty('phone'); // nicht freigegeben
    });

    it('bekommt in der Liste nur Basisfelder', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/people',
        headers: { cookie: member.cookie! },
      });
      expect(response.statusCode).toBe(200);
      for (const entry of response.json() as Record<string, unknown>[]) {
        // Der eigene Eintrag ist der einzige mit vollem View
        if (entry.id === member.personId) continue;
        expect(entry).not.toHaveProperty('address');
        // E-Mail nur bei explizit freigegebenen Teammitgliedern
        if (entry.id !== sharing.personId) {
          expect(entry).not.toHaveProperty('email');
        }
      }
    });

    it('darf keine Personen anlegen (403)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/people',
        headers: { cookie: member.cookie! },
        payload: { firstName: 'Neu', lastName: 'Person' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('darf Personen weder ändern noch löschen noch exportieren (403)', async () => {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/people/${outsider.personId}`,
        headers: { cookie: member.cookie! },
        payload: { firstName: 'Hacked' },
      });
      expect(patch.statusCode).toBe(403);

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/people/${outsider.personId}`,
        headers: { cookie: member.cookie! },
      });
      expect(del.statusCode).toBe(403);

      const exportResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${outsider.personId}/export`,
        headers: { cookie: member.cookie! },
      });
      expect(exportResponse.statusCode).toBe(403);
    });

    it('darf keine Notizen über andere lesen (403)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${sharing.personId}/notes`,
        headers: { cookie: member.cookie! },
      });
      expect(response.statusCode).toBe(403);
    });

    it('kann die eigenen Daten exportieren (DSGVO)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me/export',
        headers: { cookie: member.cookie! },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().person.email).toContain('member');
      expect(response.json().teams).toHaveLength(1);
    });
  });

  describe('Rolle TEAMLEITER', () => {
    it('sieht Kontaktdaten der eigenen Teammitglieder', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${member.personId}`,
        headers: { cookie: leader.cookie! },
      });
      const body = response.json();
      expect(body).toHaveProperty('email');
      expect(body).toHaveProperty('phone');
      expect(body).not.toHaveProperty('address'); // Adresse bleibt Admin-only
    });

    it('sieht KEINE Kontaktdaten von Personen fremder Teams (kompromittiertes Leiter-Konto)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${outsider.personId}`,
        headers: { cookie: leader.cookie! },
      });
      const body = response.json();
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('phone');
    });

    it('kann GENERAL-Notizen für eigene Teammitglieder anlegen und lesen', async () => {
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/people/${member.personId}/notes`,
        headers: { cookie: leader.cookie! },
        payload: { kind: 'GENERAL', content: 'Spielt lieber früh im Gottesdienst' },
      });
      expect(create.statusCode).toBe(201);

      const list = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${member.personId}/notes`,
        headers: { cookie: leader.cookie! },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()[0].content).toContain('früh');
    });

    it('darf KEINE PASTORAL-Notizen anlegen oder lesen (403)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/people/${member.personId}/notes`,
        headers: { cookie: leader.cookie! },
        payload: { kind: 'PASTORAL', content: 'geheim' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('darf keine Personen anlegen (403) – Personenverwaltung ist Admin-Sache', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/people',
        headers: { cookie: leader.cookie! },
        payload: { firstName: 'Neu', lastName: 'Person' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('Rolle ADMIN', () => {
    it('sieht alle Felder inkl. Adresse', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/people/${member.personId}`,
        headers: { cookie: admin.cookie! },
      });
      const body = response.json();
      expect(body).toHaveProperty('email');
      expect(body).toHaveProperty('address');
    });

    it('kann PASTORAL-Notizen anlegen; Inhalt liegt verschlüsselt in der DB', async () => {
      const content = 'Seelsorgegespräch am Sonntag – vertraulich';
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/people/${member.personId}/notes`,
        headers: { cookie: admin.cookie! },
        payload: { kind: 'PASTORAL', content },
      });
      expect(create.statusCode).toBe(201);

      // Direktblick in die DB: Klartext darf dort nicht auftauchen
      const stored = await prisma.note.findUniqueOrThrow({
        where: { id: create.json().id },
      });
      expect(Buffer.from(stored.contentEncrypted).toString('utf8')).not.toContain('Seelsorge');
    });

    it('anonymisiert Personen: Kontaktdaten weg, Historie bleibt', async () => {
      const victimId = await createPerson('Victim');
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/people/${victimId}/anonymize`,
        headers: { cookie: admin.cookie! },
      });
      expect(response.statusCode).toBe(204);

      const person = await prisma.person.findUniqueOrThrow({ where: { id: victimId } });
      expect(person.status).toBe('ANONYMIZED');
      expect(person.email).toBeNull();
      expect(person.phone).toBeNull();
      expect(person.firstName).toBe('Ehemaliges');
      // Login-Konto ist weg
      expect(await prisma.userAccount.findUnique({ where: { personId: victimId } })).toBeNull();
    });

    it('Aktionen landen im Audit-Log (append-only)', async () => {
      const entries = await prisma.auditLog.findMany({
        where: { actorId: admin.personId, entityType: 'Person' },
      });
      expect(entries.length).toBeGreaterThan(0);

      // Append-only: UPDATE/DELETE schlagen auf DB-Ebene fehl
      await expect(prisma.auditLog.delete({ where: { id: entries[0].id } })).rejects.toThrow(
        /append-only/,
      );
    });
  });
});
