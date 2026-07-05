# API-Image, Build-Kontext ist das Repo-Root:
#   docker build -f apps/api/Dockerfile .
#
# Multi-Stage: Build mit allen devDependencies, Runtime nur mit
# Produktions-Abhängigkeiten (pnpm deploy erzeugt ein isoliertes Paket).

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Erst nur Manifeste kopieren → Docker-Layer-Cache greift, solange sich
# keine Abhängigkeiten ändern
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @serveflow/shared build && pnpm --filter @serveflow/api build

# Isoliertes Produktionspaket (nur prod-Dependencies, Workspace-Pakete inklusive)
RUN pnpm --filter @serveflow/api --prod deploy --legacy /prod/api
# Prisma-Client muss im Deploy-Ordner neu generiert werden (node_modules dort sind frisch)
WORKDIR /prod/api
RUN cp -r /repo/apps/api/dist ./dist && npx prisma generate

FROM node:22-alpine
# Nicht als root laufen (Trivy-Misconfiguration-Check, Least Privilege).
# npm/npx/corepack werden zur Laufzeit nicht gebraucht und fliegen raus:
# weniger Angriffsfläche und keine CVE-Funde aus npm-Bundle-Dependencies
# (z. B. sigstore/picomatch), die mit der App nichts zu tun haben.
RUN addgroup -S serveflow && adduser -S serveflow -G serveflow \
  && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn*
WORKDIR /app
COPY --from=build --chown=serveflow:serveflow /prod/api /app
USER serveflow
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Migrationen laufen automatisch vor dem Start – Betreiber müssen bei
# Updates nur `docker compose pull && up -d` ausführen. prisma ist eine
# reguläre Dependency, das Binary liegt in node_modules/.bin (kein npx nötig).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
