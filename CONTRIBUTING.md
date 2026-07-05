# Contributing zu ServeFlow

Danke, dass du mithelfen willst!

## Entwicklung aufsetzen

Siehe Quickstart in der [README](README.md). Kurzfassung:

```bash
pnpm install
docker compose -f docker/docker-compose.dev.yml up -d
pnpm --filter @serveflow/api prisma:migrate && pnpm --filter @serveflow/api prisma:seed
pnpm dev
```

## Regeln

- **Conventional Commits** sind Pflicht (`feat:`, `fix:`, `docs:`, `chore:`, …) –
  daraus wird der Changelog generiert (release-please).
- **CI muss grün sein**, bevor ein PR gemergt wird (Lint, Typecheck, Tests, Build).
- **Kommentare erklären das Warum**, nicht das Was. Deutsch oder Englisch, aber
  konsistent pro Datei.
- **Keine hartcodierten UI-Strings** – alles über i18n (`packages/shared/i18n`).
- **Berechtigungen werden serverseitig durchgesetzt** und brauchen Negativtests:
  Jede neue Ressource bekommt Testfälle, die belegen, dass unberechtigte Rollen
  geblockt werden.
- **Keine Secrets im Code** – Konfiguration ausschließlich über Env-Vars
  (siehe `.env.example`).

## Tests

```bash
pnpm test          # Unit- und Integrationstests
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm format:check  # Prettier
```

Integrationstests brauchen die dev-Container (Postgres/Redis).

## Lizenz deiner Beiträge

Beiträge werden unter AGPL-3.0 angenommen. Mit dem Einreichen eines PRs erklärst du
dich einverstanden, dass die Maintainer deine Beiträge zusätzlich im Rahmen des
Dual-Licensing-Modells (siehe README) kommerziell lizenzieren dürfen.
