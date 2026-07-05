# Web-Image, Build-Kontext ist das Repo-Root:
#   docker build -f apps/web/Dockerfile .
#
# Stage 1 baut das statische SPA-Bundle, Stage 2 ist Caddy: übernimmt in
# Produktion TLS (Let's Encrypt), Security-Header, statisches Ausliefern
# und das Proxying von /api an den API-Container.

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @serveflow/shared build && pnpm --filter @serveflow/web build

FROM caddy:2-alpine
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
# Nicht als root laufen (Least Privilege): setcap erlaubt dem Caddy-Binary
# das Binden von Port 80/443 auch ohne root; /data und /config gehören dem
# Nutzer, damit TLS-Zertifikate geschrieben werden können.
RUN apk add --no-cache libcap \
  && setcap cap_net_bind_service=+ep /usr/bin/caddy \
  && adduser -S -D -H -u 1000 caddyuser \
  && chown -R caddyuser /data /config /srv
USER caddyuser
