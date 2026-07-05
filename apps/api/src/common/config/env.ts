// Zentrale, beim Start validierte Konfiguration.
//
// Bewusst ohne @nestjs/config: ein einziges typisiertes Objekt, das beim
// Import fail-fast validiert, ist für dieses Projekt einfacher zu verstehen
// und zu testen als DI-basierte Config – und Fehlkonfiguration fällt sofort
// beim Container-Start auf, nicht erst beim ersten Request.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Fehlende Umgebungsvariable: ${name} (siehe .env.example)`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function intFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Umgebungsvariable ${name} muss eine Zahl sein, ist aber: ${raw}`);
  }
  return parsed;
}

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  API_PORT: intFrom('API_PORT', 3000),
  APP_URL: optional('APP_URL', 'http://localhost:5173'),
  DEFAULT_LOCALE: optional('DEFAULT_LOCALE', 'de'),

  DATABASE_URL: isTest
    ? optional('DATABASE_URL', 'postgresql://serveflow:serveflow@localhost:5432/serveflow_test')
    : required('DATABASE_URL'),
  REDIS_URL: optional('REDIS_URL', 'redis://localhost:6379'),

  // In dev/test gibt es harmlose Defaults; in Produktion (NODE_ENV=production)
  // MÜSSEN echte Secrets gesetzt sein – sonst startet die API nicht.
  COOKIE_SECRET:
    process.env.NODE_ENV === 'production'
      ? required('COOKIE_SECRET')
      : optional('COOKIE_SECRET', 'dev-only-cookie-secret'),
  FIELD_ENCRYPTION_KEY:
    process.env.NODE_ENV === 'production'
      ? required('FIELD_ENCRYPTION_KEY')
      : optional('FIELD_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64')),
  SESSION_TTL_HOURS: intFrom('SESSION_TTL_HOURS', 336),

  SMTP_HOST: optional('SMTP_HOST', 'localhost'),
  SMTP_PORT: intFrom('SMTP_PORT', 1025),
  SMTP_SECURE: optional('SMTP_SECURE', 'false') === 'true',
  SMTP_USER: optional('SMTP_USER', ''),
  SMTP_PASS: optional('SMTP_PASS', ''),
  SMTP_FROM: optional('SMTP_FROM', 'ServeFlow <noreply@example.org>'),

  // Erst-Einrichtung: legt beim Start EIN Admin-Konto an, falls noch
  // kein Konto existiert (siehe bootstrap-admin.service.ts)
  SEED_ADMIN_EMAIL: optional('SEED_ADMIN_EMAIL', ''),
  SEED_ADMIN_PASSWORD: optional('SEED_ADMIN_PASSWORD', ''),

  REMINDER_DAYS_BEFORE: optional('REMINDER_DAYS_BEFORE', '7,1')
    .split(',')
    .map((d) => Number.parseInt(d.trim(), 10))
    .filter((d) => !Number.isNaN(d) && d > 0),
} as const;

// Produktions-Guard gegen die dev-Defaults aus .env.example
if (env.NODE_ENV === 'production') {
  for (const [key, value] of [
    ['COOKIE_SECRET', env.COOKIE_SECRET],
    ['FIELD_ENCRYPTION_KEY', env.FIELD_ENCRYPTION_KEY],
  ] as const) {
    if (value.startsWith('CHANGE_ME')) {
      throw new Error(`${key} enthält noch den Platzhalter aus .env.example`);
    }
  }
}
