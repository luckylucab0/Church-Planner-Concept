# Web-Image, Build-Kontext ist das Repo-Root:
#   docker build -f apps/web/Dockerfile .
#
# Stage 1 baut das statische SPA-Bundle, Stage 2 kompiliert Caddy samt
# CrowdSec-Bouncer-Modulen, Stage 3 ist Caddy: übernimmt in Produktion
# TLS (Let's Encrypt), Security-Header, statisches Ausliefern, das
# Proxying von /api an den API-Container und – nur wenn deployment-seitig
# CROWDSEC_*-Variablen gesetzt sind – die AppSec-Prüfung (WAF) jeder
# Anfrage durch eine CrowdSec-Instanz.

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

# Caddy mit CrowdSec-Modulen (http-Bouncer + AppSec): das offizielle Binary
# enthält keine Third-Party-Module, deshalb Eigenbau per xcaddy. xcaddy baut
# exakt die Caddy-Version des Builder-Images (CADDY_VERSION) – kein
# Caddy-Versionssprung gegenüber caddy:2-alpine unten.
# --platform=$BUILDPLATFORM + GOOS/GOARCH: der Go-Compiler läuft nativ und
# cross-kompiliert ohne QEMU für die Ziel-Architektur (amd64 + arm64).
# Modul-Pin v0.14.1 passt zu Caddy 2.11.x (go.mod des Moduls verlangt
# caddy v2.11.3) – bei einem Caddy-Versionssprung den Pin mitprüfen.
FROM --platform=$BUILDPLATFORM caddy:2-builder AS caddy-builder
ARG TARGETOS TARGETARCH
# Die beiden --replace heben transitive Abhängigkeiten mit bekannten CVEs
# (x/text: CVE-2026-56852, grpc: GHSA-hrxh-6v49-42gf) auf die gefixten
# Patch-Versionen – ohne sie schlägt der Trivy-Image-Scan an. Beim Bump
# des Modul-Pins prüfen, ob die Replaces noch nötig sind, und sie sonst
# entfernen (ein Replace erzwingt die Version auch, wenn Upstream längst
# neuer ist).
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH xcaddy build \
  --with github.com/hslatman/caddy-crowdsec-bouncer/http@v0.14.1 \
  --with github.com/hslatman/caddy-crowdsec-bouncer/appsec@v0.14.1 \
  --replace golang.org/x/text=golang.org/x/text@v0.39.0 \
  --replace google.golang.org/grpc=google.golang.org/grpc@v1.82.1

FROM caddy:2-alpine
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
# Bedingt importierte CrowdSec-Snippets (on/off, siehe Caddyfile) und der
# Entrypoint, der den Schalter aus CROWDSEC_API_KEY ableitet.
COPY docker/caddy/crowdsec /etc/caddy/crowdsec
COPY --chmod=755 docker/caddy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=build /repo/apps/web/dist /srv
# Das selbst gebaute Binary ersetzt das Original – VOR dem setcap unten,
# damit die Capability auf dem neuen Binary landet (ein späteres COPY
# würde das xattr wieder entfernen).
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
# Nicht als root laufen (Least Privilege): setcap erlaubt dem Caddy-Binary
# das Binden von Port 80/443 auch ohne root; /data und /config gehören dem
# Nutzer, damit TLS-Zertifikate geschrieben werden können.
# apk upgrade zieht Fixes für Alpine-CVEs, die das Basis-Image noch nicht
# enthält (z. B. c-ares) – ohne Upgrade blockiert der Trivy-Scan.
RUN apk upgrade --no-cache \
  && apk add --no-cache libcap \
  && setcap cap_net_bind_service=+ep /usr/bin/caddy \
  && adduser -S -D -H -u 1000 caddyuser \
  && chown -R caddyuser /data /config /srv
USER caddyuser
# ACHTUNG: Ein ENTRYPOINT verwirft das vom Basis-Image geerbte CMD,
# deshalb wird das Standard-CMD hier explizit wiederholt.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
