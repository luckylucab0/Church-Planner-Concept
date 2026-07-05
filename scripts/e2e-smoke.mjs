// E2E-Smoke-Test des Zusage/Absage-Flows gegen das komplette, per
// Docker Compose hochgefahrene System (docker/docker-compose.e2e.yml):
//
//   Login (Erst-Admin) → Team/Position/Person/Skill anlegen →
//   Termin + Slot anlegen → Person einteilen → Mail aus Mailpit fischen →
//   Accept-Link ausführen → Status im Plan prüfen.
//
// Bewusst pures Node (fetch) statt Browser-Framework: getestet wird die
// echte Kette Caddy → API → DB/Redis → SMTP, nicht das React-Rendering.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8026';

let cookie = '';

async function api(method, path, body) {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie?.includes('serveflow_session=')) {
    cookie = setCookie.split(';')[0];
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

async function waitFor(label, probe, attempts = 30, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await probe();
      if (result) return result;
    } catch {
      // weiter warten
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timeout: ${label}`);
}

console.log('1/8 Warte auf das System (Caddy → API → DB)…');
await waitFor('health', async () => {
  const response = await fetch(`${BASE}/api/health`);
  return response.ok;
});

console.log('2/8 Login als Erst-Admin…');
await api('POST', '/auth/login', {
  email: 'admin@e2e.local',
  password: 'e2e-admin-passwort-1!',
});

console.log('3/8 Team, Position, Person und Skill anlegen…');
const team = await api('POST', '/teams', { name: 'E2E-Worship' });
const position = await api('POST', `/teams/${team.id}/positions`, { name: 'Gitarre' });
const person = await api('POST', '/people', {
  firstName: 'Emma',
  lastName: 'E2E',
  email: 'emma@e2e.local',
});
await api('POST', `/teams/${team.id}/members`, { personId: person.id });
await api('PUT', `/positions/${position.id}/skills/${person.id}`, { skillLevel: 'SOLID' });

console.log('4/8 Termin mit Slot anlegen und veröffentlichen…');
const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
const endsAt = new Date(Date.now() + 7 * 86_400_000 + 90 * 60_000).toISOString();
const event = await api('POST', '/events', { title: 'E2E-Gottesdienst', startsAt, endsAt });
await api('PUT', `/events/${event.id}/slots`, {
  items: [{ positionId: position.id, requiredCount: 1 }],
});
await api('PATCH', `/events/${event.id}`, { status: 'PUBLISHED' });

console.log('5/8 Person einteilen (löst die Einteilungs-Mail aus)…');
const detail = await api('GET', `/events/${event.id}`);
const slotId = detail.slots[0].id;
await api('POST', '/assignments', { slotId, personId: person.id });

console.log('6/8 Mail aus Mailpit fischen und Respond-Token extrahieren…');
const token = await waitFor('Einteilungs-Mail in Mailpit', async () => {
  const list = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const message = list.messages?.find((m) => m.To?.some((to) => to.Address === 'emma@e2e.local'));
  if (!message) return null;
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
  const match = full.Text?.match(/\/respond\/([A-Za-z0-9_-]+)\?action=accept/);
  return match?.[1] ?? null;
});

console.log('7/8 Zusage über den Token-Link (ohne Login)…');
const respondInfo = await (await fetch(`${BASE}/api/v1/respond/${token}`)).json();
if (respondInfo.firstName !== 'Emma') {
  throw new Error(`Respond-Info falsch: ${JSON.stringify(respondInfo)}`);
}
const accept = await fetch(`${BASE}/api/v1/respond/${token}/accept`, { method: 'POST' });
if (!accept.ok) throw new Error(`Accept fehlgeschlagen: ${accept.status}`);

console.log('8/8 Status im Plan prüfen…');
const after = await api('GET', `/events/${event.id}`);
const assignment = after.slots[0].assignments[0];
if (assignment.status !== 'ACCEPTED') {
  throw new Error(`Erwartet ACCEPTED, ist ${assignment.status}`);
}

console.log('✅ E2E-Smoke erfolgreich: Einteilung → Mail → Zusage → Plan aktualisiert');
