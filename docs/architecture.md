# Architektur

## Überblick

- **Monorepo** (pnpm workspaces): `apps/api` (NestJS + Fastify), `apps/web`
  (Vite + React SPA), `packages/shared` (geteilte Typen + i18n-Ressourcen).
- **API-first:** Das Frontend spricht ausschließlich die REST-API unter `/api/v1`.
  OpenAPI-Doku wird aus den DTOs generiert (Swagger UI unter `/api/docs`).
- **PostgreSQL** via Prisma (versionierte Migrationen), **Redis** für Sessions
  und BullMQ-Job-Queue (Erinnerungen, Mail-Versand, Import-Verarbeitung).
- **Caddy** als Reverse Proxy: Auto-TLS, HSTS/Security-Header, liefert das
  SPA-Bundle statisch aus und proxied `/api/*` an die API.

## Warum diese Entscheidungen?

| Entscheidung                          | Begründung                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS mit Fastify-Adapter            | Module/Guards/Interceptors passen zu RBAC + Field-Level-Filtering; OpenAPI aus DTOs; Fastify statt Express für Performance                                |
| Prisma                                | Typsichere Queries, deklarative Migrationen, sauberer CI-Migrationscheck                                                                                  |
| Vite-SPA statt Next.js                | Login-geschützte App ohne SEO-Bedarf; statisches Bundle hinter Caddy = ein Node-Prozess weniger; erzwingt saubere API-Trennung für die spätere Mobile-App |
| Sessions statt JWT                    | Sofortige Revocation (kompromittierte Konten), besserer CSRF-Schutz, keine Tokens im Browser-Storage                                                      |
| release-please statt semantic-release | PR-basiert, kompatibel mit Branch Protection (kein Direkt-Push auf `main`)                                                                                |

## Berechtigungsmodell

Rollen: **Admin** (global, `UserAccount.globalRole`), **Teamleiter**
(pro Team, `TeamMembership.isLeader`), **Mitglied** (Default).

Durchsetzung ausschließlich serverseitig:

1. **Policies** pro Ressource entscheiden über Zugriff (403 bei fremden Ressourcen).
2. Ein zentraler **Field-Visibility-Layer** filtert Response-Felder je nach Rolle und
   Beziehung (gemeinsames Team? Teamleiter? PrivacySettings der Zielperson?).
   Unsichtbare Felder fehlen in der Response komplett (kein `null`).

Details und Matrix: siehe [security.md](security.md) und die Policy-Tests in
`apps/api/src/authz/`.

## Hintergrundjobs

BullMQ-Queues (Redis): `notifications` (Mail-Versand), `reminders` (geplante
Erinnerungen 7d/1d vor Termin), `imports` (CSV-Verarbeitung). Der Worker läuft im
selben API-Prozess (MVP, ein Server) – als eigener Prozess skalierbar, sobald nötig.
