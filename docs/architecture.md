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

Zwei Ebenen:

1. **Globale Rolle** auf dem Login-Konto: `UserAccount.globalRole` ist `ADMIN`
   oder `MEMBER`. Sie steckt in der Redis-Session und wird vom `AdminGuard`
   über `@RequireAdmin()` durchgesetzt.
2. **Teamrolle pro Mitgliedschaft**: `TeamMembership.role` ist `LEADER`,
   `DEPUTY`, `MEMBER` oder `INTERN` – bewusst keine globale Rolle, damit ein
   kompromittiertes Leiter-Konto nie über das eigene Team hinausreicht. Was
   die Rollen dürfen, steht in der **Rechtematrix** – der Tabelle
   `TeamRolePermission` mit `teamId`, `role`, `capability` und `allowed`.

Die Matrix arbeitet mit **Lazy Defaults**: eine fehlende Zeile bedeutet nicht
„verboten", sondern „Code-Default" aus
`apps/api/src/authz/team-capabilities.ts`. Neue Capabilities brauchen deshalb
keine Datenmigration. `LEADER` wird nie gespeichert – die Rolle hat implizit
alle Team-Rechte, damit sich ein Team nicht selbst aussperren kann. Wer die
Matrix bearbeiten darf (Admin oder LEADER), kann sich daher auch keine Rechte
selbst zuschanzen.

**Teamübergreifende Capabilities.** Ablaufplan (`EDIT_PLAN`), Liederdatenbank
(`MANAGE_SONGS`), Termin-Entwürfe (`VIEW_DRAFTS`) und Termine
(`MANAGE_EVENTS`) gehören nicht einem Team, sondern der Gemeinde. Sie werden
mit `hasCapabilityInAnyTeam` aufgelöst: wer das Recht in _einem_ Team hat, übt
es überall aus. Damit lässt sich z. B. ein Team „Moderation" anlegen, dessen
Mitglieder Gottesdienste planen, ohne Admin-Rechte auf Personendaten zu
bekommen. Voreingestellt sind diese Rechte für `MANAGE_EVENTS` bei allen
konfigurierbaren Rollen **aus**.

**Was Admin bleibt.** Delegierbar ist das Planen einzelner Termine. Nicht
delegierbar sind Operationen, die strukturell oder unumkehrbar sind:
Personenverwaltung und Import, Teams anlegen/löschen, die Rolle `LEADER`
vergeben, die Gottesdienst-Typen samt RRULE, Positions-Vorlage und
Serien-Generierung (materialisiert bis zu 366 Tage auf einmal) sowie
`DELETE /events/:id`, das Slots, Einteilungen und Ablaufplan per Cascade
mitnimmt. Für alle anderen ist **Absagen** der vorgesehene Weg. Das Entfernen
einer besetzten Position antwortet mit `409`, bis der Aufrufer sie mit
`force` ausdrücklich bestätigt.

Die globale Rolle vergeben Admins über `PATCH /people/:id/role`. Zwei Regeln
sichern das ab: Die **eigene** Rolle lässt sich nicht ändern – dadurch bleibt
immer mindestens ein Admin übrig, eine Instanz kann sich also nicht aussperren.
Und jeder Wechsel **beendet alle Sitzungen** des betroffenen Kontos, weil die
Rolle in der Session steckt; ohne das behielte ein herabgestufter Admin seine
Rechte bis zum Ablauf der Sitzung.

Durchsetzung ausschließlich serverseitig:

1. **Policies** pro Ressource entscheiden über Zugriff (403 bei fremden Ressourcen).
2. Ein zentraler **Field-Visibility-Layer** filtert Response-Felder je nach Rolle und
   Beziehung (gemeinsames Team? Teamleiter? PrivacySettings der Zielperson?).
   Unsichtbare Felder fehlen in der Response komplett (kein `null`).

Die `can*`-Felder in den API-Antworten (`canManageEvent`, `canEditPlan`,
`canAssign`, …) und `canManageEvents` in `GET /auth/session` steuern nur, was
die Oberfläche anbietet; jeder Endpunkt prüft unabhängig davon selbst.

Details: [security.md](security.md), die Default-Matrix in
`apps/api/src/authz/team-capabilities.ts` und die Policy-Tests in
`apps/api/src/authz/` sowie `apps/api/test/team-roles.int-spec.ts`.

## Hintergrundjobs

BullMQ-Queues (Redis): `notifications` (Mail-Versand), `reminders` (geplante
Erinnerungen 7d/1d vor Termin), `imports` (CSV-Verarbeitung). Der Worker läuft im
selben API-Prozess (MVP, ein Server) – als eigener Prozess skalierbar, sobald nötig.
