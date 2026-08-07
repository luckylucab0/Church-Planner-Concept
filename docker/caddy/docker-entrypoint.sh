#!/bin/sh
# Warum ein eigener Entrypoint: Der crowdsec-Block in der Caddyfile darf
# nur geladen werden, wenn wirklich ein API-Key vorhanden ist – ein leerer
# api_key ist für Caddy ein fataler Validierungsfehler, der Container
# würde gar nicht starten. Ohne CROWDSEC_API_KEY importiert die Caddyfile
# stattdessen die leeren off-Snippets und Caddy startet exakt wie bisher.
# CROWDSEC_ENABLED ist ein internes Detail und wird immer überschrieben –
# nach außen zählen nur die drei dokumentierten CROWDSEC_*-Variablen
# (siehe .env.example).
set -eu

if [ -n "${CROWDSEC_API_KEY:-}" ]; then
	export CROWDSEC_ENABLED=on
else
	export CROWDSEC_ENABLED=off
	if [ -n "${CROWDSEC_LAPI_URL:-}" ] || [ -n "${CROWDSEC_APPSEC_URL:-}" ]; then
		echo "WARN: CROWDSEC_LAPI_URL/CROWDSEC_APPSEC_URL gesetzt, aber CROWDSEC_API_KEY fehlt – CrowdSec bleibt deaktiviert." >&2
	fi
fi

exec "$@"
