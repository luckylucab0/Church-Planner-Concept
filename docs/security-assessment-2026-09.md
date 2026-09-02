# Security Assessment & Pentest – September 2026

**Prüfgegenstand:** ServeFlow (API, Web-Frontend, Edge, CI/CD)
**Stand:** Commit `726e3a9` (Version 0.12.0), Branch `claude/security-assessment-pentesting-v00hoq`
**Art:** Quellcode-Review, statische Analyse und aktiver Test gegen laufende Instanzen (Grey-Box, Zugangsdaten bekannt)

---

## Zusammenfassung

Die Anwendung ist sicherheitstechnisch überdurchschnittlich sorgfältig gebaut.
Alle klassischen Einfallstore der OWASP Top 10 waren bereits vor diesem
Assessment geschlossen: keine SQL-Injection (durchgängig parametrisierte
Prisma-Queries, keine einzige Raw-Query mit String-Konkatenation), kein XSS im
Frontend (kein `dangerouslySetInnerHTML`, keine Tokens im Browser-Storage),
kein SSRF im Planning-Center-Import, ein per Datenbank-Trigger erzwungenes
Append-only-Audit-Log und eine serverseitige Field-Level-Sichtbarkeit, die
Kontaktdaten schon aus der Antwort entfernt statt sie nur auszublenden.

Gefunden wurden **12 Schwachstellen**, überwiegend in der zweiten
Verteidigungslinie: Bruteforce-Schutz des zweiten Faktors, Entschärfung von
Daten auf dem Weg nach draußen (CSV, iCal) und Absicherung gegen
Fehlkonfiguration im Betrieb. **11 davon sind behoben**, eine ist bewusst als
akzeptiertes Restrisiko dokumentiert.

| Schweregrad | Gefunden | Behoben | Offen |
| ----------- | -------- | ------- | ----- |
| Hoch        | 2        | 2       | 0     |
| Mittel      | 4        | 4       | 0     |
| Niedrig     | 6        | 5       | 1     |

Die drei wichtigsten Befunde:

1. **Der zweite Faktor war nicht gegen Bruteforce geschützt** (SF-11). Falsche
   TOTP-Codes zählten nicht zum Konto-Lockout – wer ein Passwort bereits kannte,
   konnte Codes praktisch unbegrenzt raten.
2. **Die vollständige API-Dokumentation war in Produktion anonym abrufbar**
   (SF-01) – eine fertige Landkarte aller Endpunkte und Datenfelder.
3. **Eine Fehlkonfiguration der Verschlüsselung fiel erst im Betrieb auf**
   (SF-02). Die API startete mit unbrauchbarem Schlüssel fehlerfrei und
   quittierte erst die erste 2FA-Einrichtung einer echten Person mit HTTP 500.

---

## Vorgehen

### Prüfumgebung

Weil in der Prüfumgebung kein Docker-Daemon zur Verfügung stand, wurde das
Testlabor aus Einzelprozessen aufgebaut (PostgreSQL 16, Redis 7, ein eigener
SMTP-Fänger, mehrere API-Instanzen). Der Aufbau ist mit
`scripts/security/lab-up.sh` reproduzierbar.

Getestet wurde gegen drei parallele Instanzen, weil sich einige Anforderungen
gegenseitig ausschließen:

| Instanz | Konfiguration                              | Zweck                                  |
| ------- | ------------------------------------------ | -------------------------------------- |
| `:3000` | `NODE_ENV=development`, echter Mailversand | Token-Flows (Einladung, Reset, iCal)   |
| `:3001` | `NODE_ENV=production`, echte Secrets       | Verhalten der Produktionskonfiguration |
| `:3002` | `NODE_ENV=test` (Rate Limiting aus)        | Bruteforce-Checks ohne 429-Störung     |

**Methodischer Hinweis:** Ein einzelner Testlauf kann nicht alles abdecken.
`NODE_ENV=test` schaltet das Rate Limiting ab – nötig, um den Konto-Lockout
überhaupt beobachten zu können – schaltet aber zugleich den Mailversand auf
`jsonTransport` um, wodurch Token-Flows unprüfbar werden. Ergebnisse, die durch
ein `429` verfälscht wurden, sind im Werkzeug bewusst als `SKIP` markiert statt
als Erfolg gewertet. Wo der HTTP-Status allein nicht eindeutig war, wurde der
Datenbankzustand direkt geprüft (siehe SF-11).

### Eingesetzte Werkzeuge

- **`scripts/security/pentest.mjs`** – eigens entwickelt, 21 Checks. Ein
  generischer Scanner kennt weder die Rollenmatrix noch die Token-Semantik
  dieser Anwendung und hätte genau die gefundenen Schwachstellen übersehen.
- **semgrep** 1.x (`p/nodejs`, `p/typescript`, `p/owasp-top-ten`) – 1 Befund (SF-09).
- **Manuelle Quellcode-Analyse** – Auth-/Session-Kette, Rollen- und
  Rechteprüfung, Token-Lebenszyklen, Ausgabepfade, Edge- und CI-Konfiguration.

### Ergebnis der Testläufe

| Lauf                                              | PASS | FAIL  | INFO | SKIP |
| ------------------------------------------------- | ---- | ----- | ---- | ---- |
| **Vorher** (`:3002`, ohne Rate Limiting)          | 9    | 7     | 7    | 2    |
| **Nachher** (`:3002`, ohne Rate Limiting)         | 15   | 2¹    | 6    | 2    |
| **Nachher** (`:3000`, Dev mit echtem Mailversand) | 15   | 1¹    | 6    | 3    |
| **Nachher** (`:3001`, Produktionskonfiguration)   | 3    | **0** | 3    | 0²   |

¹ Auf diesen Instanzen erwartbar und gegengeprüft: Swagger ist außerhalb der
Produktion absichtlich aktiv (auf `:3001` liefert es 404), und `NODE_ENV=test`
schaltet das Rate Limiting bewusst ab (auf `:3000`/`:3001` greift es).
² Lauf im `SAFE`-Modus, wie ihn auch die CI ausführt: nur lesende Checks.

**Alle ursprünglich gefundenen Schwachstellen sind in den Nachher-Läufen
geschlossen.** Die verbliebenen `SKIP`-Meldungen sind ehrliche
Nicht-Aussagen (Rate Limit erreicht oder kein Mailversand auf dieser Instanz),
keine stillschweigend bestandenen Prüfungen.

---

## Befunde

### SF-11 · Zweiter Faktor ohne Bruteforce-Schutz — **Hoch** — behoben

`apps/api/src/auth/auth.service.ts`

Falsche TOTP- und Backup-Codes erhöhten `failedLoginCount` nicht. Der
Konto-Lockout griff damit ausschließlich für falsche **Passwörter**, nicht für
den zweiten Faktor. Wer ein Passwort bereits kannte (Leak, Phishing,
Wiederverwendung), konnte den 6-stelligen Code raten; gebremst wurde das nur
durch das IP-basierte Rate Limit, das sich durch Verteilung auf mehrere Adressen
umgehen lässt. Zusätzlich fehlte ein Replay-Schutz: Ein einmal abgefangener Code
blieb sein ganzes Zeitfenster (bis 90 s) hindurch mehrfach einlösbar.

**Nachweis** (Datenbankzustand, damit das Ergebnis unabhängig vom HTTP-Status ist):

```
--- Referenz: falsche PASSWÖRTER ---
nach 8 falschen Passwörtern -> failedLoginCount = 5 | lockedUntil=2026-09-02 18:27:52

--- Test: falsche TOTP-CODES bei korrektem Passwort ---
15x falscher Code, HTTP-Status: 401
>>> failedLoginCount danach = 0 | lockedUntil=NULL
>>> Login mit GÜLTIGEM Code danach: 200  => Konto NICHT gesperrt

--- TOTP-Replay ---
gleicher Code 2x: 200 / 200  => kein Replay-Schutz
```

**Behebung:** Fehlversuche beider Faktoren laufen jetzt über dieselbe Methode
`countFailedAttempt`. Zusätzlich verbraucht `SessionService.consumeTotpCode`
jeden Code einmalig über einen atomaren Redis-Eintrag (`SET NX`, 90 s).
Regressionstests: `apps/api/test/security.int-spec.ts`.

---

### SF-01 · API-Dokumentation in Produktion öffentlich — **Hoch** — behoben

`apps/api/src/main.ts`

`SwaggerModule.setup()` registriert seine Route direkt am HTTP-Adapter und
umgeht damit sämtliche NestJS-Guards – `@Public()` ist dafür nicht nötig, der
`SessionAuthGuard` greift für diese Route schlicht nicht. Die Registrierung war
an keine Bedingung geknüpft, sodass unter `/api/docs` und `/api/docs-json` die
vollständige API-Oberfläche samt aller DTO-Felder anonym abrufbar war. Caddy
reicht `/api/*` unverändert weiter.

**Nachweis:** Auf der lokalen Instanz mit `NODE_ENV=production`:
`GET /api/docs -> 200`, `GET /api/docs-json -> 200`.

**Einordnung:** Auf der geprüften Instanz `churchtest.bortoletto.tech` lieferten
beide Pfade **404** – dort ist die Dokumentation aktuell also nicht erreichbar
(vermutlich ein älteres Image). Der Befund ist damit für diese eine Instanz
nicht belegt, im Code aber real und beim nächsten Deployment wirksam.

**Behebung:** Swagger wird nur noch außerhalb von `NODE_ENV=production`
registriert. Verifiziert: `/api/docs -> 404` in der Produktionskonfiguration.

---

### SF-02 · Fehlkonfiguration fällt erst im Betrieb auf — **Mittel** — behoben

`apps/api/src/common/config/env.ts`

Geprüft wurde beim Start nur, ob die Secrets noch den `CHANGE_ME`-Platzhalter
tragen – nicht, ob sie brauchbar sind. Die Länge des
`FIELD_ENCRYPTION_KEY` wurde erst beim ersten Ver-/Entschlüsseln geprüft.

**Nachweis:** Eine Instanz mit `NODE_ENV=production`, `COOKIE_SECRET=short` und
einem 8-Byte-Schlüssel startete fehlerfrei und meldete `{"status":"ok"}`. Erst
das erste 2FA-Setup schlug fehl:

```
HTTP 500
ERROR [ExceptionsHandler] Error: FIELD_ENCRYPTION_KEY muss 32 Bytes base64-codiert sein
```

Ein Betreiber merkt den Fehler also erst, wenn ein Mitglied 2FA einrichten oder
eine Notiz speichern will – möglicherweise Wochen nach dem Deployment.

Zusätzlich fehlte eine Prüfung von `APP_URL`. Diese eine Variable bestimmt die
CORS-Herkunft, den CSRF-Origin-Check und alle Links in E-Mails; sie ist im
Produktions-Compose nicht gesetzt und fiele damit auf `http://localhost:5173`
zurück.

**Behebung:** Mit `NODE_ENV=production` verweigert die API den Start bei zu
kurzem `COOKIE_SECRET` (< 32 Zeichen), bei einem `FIELD_ENCRYPTION_KEY` ≠ 32 Byte
base64 und bei einer `APP_URL` ohne `https://` (localhost ausgenommen – der
E2E-Stack fährt dieselben Images bewusst ohne TLS). Alle drei Fehlerfälle
verifiziert.

---

### SF-18 · CSV-Formel-Injection im Import-Fehlerreport — **Mittel** — behoben

`apps/api/src/import/import.service.ts`, `import.controller.ts`

Der herunterladbare Fehlerreport spiegelt die hochgeladenen Rohzellen zurück.
Excel, LibreOffice und Google Sheets werten eine Zelle, die mit `=`, `+`, `-`
oder `@` beginnt, als **Formel** aus. Das korrekte CSV-Quoting von
`csv-stringify` hilft dagegen nicht: Die Tabellenkalkulation entfernt die
Anführungszeichen beim Parsen und wertet den Inhalt danach aus.

Angriffsweg: Wer eine Import-Datei liefert (z. B. einen Export aus Elvanto oder
Planning Center), platziert eine präparierte Zelle in einer fehlerhaften Zeile.
Die Zelle landet im Fehlerreport, den die **Admin-Person** herunterlädt und
öffnet – Codeausführung auf deren Rechner.

**Nachweis:** Import mit der Zelle `=cmd|' /C calc'!A0`; der Report gab sie
unverändert zurück.

**Behebung:** Neuer Helfer `apps/api/src/common/csv-safe.ts` stellt gefährlichen
Zellen ein einfaches Anführungszeichen voran (OWASP-Empfehlung) – der Wert bleibt
lesbar, wird aber als Text behandelt. Angewendet auf den Fehlerreport und den
PCO-API-Pfad. Tests: `csv-safe.spec.ts`, `security.int-spec.ts`.

---

### SF-19 · Zeilen-Injektion in den iCal-Feed — **Mittel** — behoben

`apps/api/src/calendar/calendar.service.ts`

`escapeIcs` maskierte `\n`, aber kein einzelnes `\r`. Zeilen eines
iCal-Dokuments werden per CRLF getrennt; ein rohes CR mitten in einem Wert
lassen viele Parser trotzdem als Zeilenende durchgehen. Der Terminort ist ein
Freitextfeld ohne Newline-Sperre.

**Nachweis:** Termin mit dem Ort `Saal\rX-PENTEST-INJECTED:ja`, abgerufener Feed:

```
LOCATION:Saal<CR>X-PENTEST-INJECTED:ja<CR>
```

Der Feed landet im Kalender **aller eingeteilten Personen** – die Wirkung trifft
also nicht nur den Verursacher. Zusätzlich fehlte die von RFC 5545 geforderte
Zeilenfaltung ab 75 Oktett.

**Behebung:** `escapeIcs` normalisiert `\r` und `\r\n` auf `\n`, verwirft übrige
Steuerzeichen; `foldIcsLine` faltet Zeilen korrekt und trennt dabei nie mitten
in einem UTF-8-Zeichen.

---

### SF-06 · Cookie-Secret ohne Wirkung — **Mittel** — behoben

`apps/api/src/auth/auth.controller.ts`, `guards/session-auth.guard.ts`

`COOKIE_SECRET` war konfiguriert und `@fastify/cookie` damit registriert, aber
kein Cookie wurde je signiert (`signed: true` fehlte). Die Konfiguration
suggerierte einen Schutz, den es nicht gab; `docs/security.md` nannte zudem einen
„Double-Submit-Token", den es im Code nie gab.

**Einordnung:** Praktisch kaum ausnutzbar – der Session-Token ist 128 Bit
Zufall und wird serverseitig in Redis nachgeschlagen. Der Befund ist vor allem
eine irreführende Konfiguration und eine fehlende Verteidigungslinie.

**Behebung:** Das Session-Cookie wird signiert ausgestellt und die Signatur im
Guard geprüft, bevor Redis überhaupt befragt wird. **Betriebshinweis:** Beim
Deployment werden alle bestehenden Sessions ungültig, alle müssen sich neu
anmelden. Die Doku-Behauptung wurde auf den tatsächlichen Mechanismus korrigiert.

---

### SF-12 · Unvollständige Content-Security-Policy — **Mittel** — behoben

`docker/caddy/Caddyfile`

Der CSP fehlten `frame-ancestors`, `base-uri`, `form-action` und `object-src`;
`Permissions-Policy` fehlte ganz. Besonders `frame-ancestors` wiegt schwer:
Moderne Browser ignorieren `X-Frame-Options`, sobald eine CSP vorhanden ist –
der Clickjacking-Schutz hing also allein am Legacy-Header.

**Nachweis:** Live gegen `churchtest.bortoletto.tech` bestätigt:
`content-security-policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`

**Behebung:** Die vier Direktiven ergänzt und eine `Permissions-Policy` gesetzt,
die Kamera, Mikrofon, Standort, Zahlung und USB abschaltet.

---

### SF-13 · GitHub Actions nicht SHA-gepinnt — **Niedrig** — behoben

`.github/workflows/*.yml`

Drittanbieter-Actions waren vorbildlich SHA-gepinnt, `actions/checkout@v7`,
`actions/setup-node@v7` und `github/codeql-action/*@v4` dagegen nur per Tag –
und Tags sind verschiebbar. `docs/security.md` behauptete bereits vollständiges
SHA-Pinning (A08). Da die Workflows Schreibrechte auf Packages und die
cosign-Signatur besitzen, wäre ein übernommenes Tag ein Lieferketten-Risiko.

**Behebung:** Alle Actions auf Commit-SHA gepinnt (mit Versions-Kommentar). Die
Aussage in der Doku stimmt jetzt.

---

### SF-17 · Body-Limit widersprach der DTO-Grenze — **Niedrig** — behoben

`apps/api/src/main.ts`

Die Import-DTOs erlauben 5 MB Inhalt, Fastifys Standard-Limit liegt bei 1 MiB.
Ein laut Dokumentation zulässiger Import scheiterte mit HTTP 413, bevor die
Validierung überhaupt lief. Funktionaler Fehler ohne Sicherheitswirkung, aber
irreführend.

**Behebung:** `bodyLimit` auf 6 MB gesetzt – knapp über der DTO-Grenze, mit
Platz für JSON-Overhead.

---

### SF-16 · Ungültige Datumsparameter erzeugten HTTP 500 — **Niedrig** — behoben

`apps/api/src/scheduling/scheduling.controller.ts`

`GET /events?from=keinDatum` reichte ein `Invalid Date` an Prisma weiter und
endete in einer unbehandelten Ausnahme. Ein Client-Fehler gehört mit 400
beantwortet; 500er verrauschen zudem das Monitoring.

**Behebung:** `parseDateParam` validiert und antwortet mit 400.

---

### SF-09 · GCM-Entschlüsselung ohne feste Auth-Tag-Länge — **Niedrig** — behoben

`apps/api/src/common/crypto/field-crypto.ts` (Fund von semgrep)

`createDecipheriv` wurde ohne `authTagLength` aufgerufen. Node akzeptiert dann
auch verkürzte Auth-Tags (ab 4 Byte), was die Integritätsgarantie von AES-GCM
erheblich schwächt. Ausnutzbar nur mit Schreibzugriff auf die Datenbank – der
Aufwand für die Behebung ist aber minimal.

**Behebung:** `authTagLength: 16` explizit gesetzt.

---

### SF-10 · Passwort-Reset prüfte den Token-Zweck nicht — **Niedrig** — behoben

`apps/api/src/auth/auth.service.ts`

`confirmPasswordReset` prüfte `usedAt`, `expiresAt` und die Existenz eines
Kontos – aber nicht `record.purpose`. Ein Einladungs-Token (7 Tage gültig) hätte
damit als Reset-Token gewirkt, dessen Gültigkeit bewusst auf 1 Stunde begrenzt ist.

**Ausnutzbarkeit: nicht gegeben.** Der Angriff wurde versucht und schlug fehl.
Grund: `sendInvite` verweigert Einladungen für Personen, die bereits ein Konto
haben, und `confirmPasswordReset` verlangt umgekehrt ein Konto. Ein unbenutztes
INVITE-Token und ein bestehendes Konto können daher nie gleichzeitig existieren –
`invite.service.ts` ist der einzige Pfad, der Konten anlegt. Die beiden
Bedingungen sichern sich also gegenseitig ab.

**Behebung dennoch:** `purpose` wird jetzt mitgeprüft. Ein Token soll nur für
seinen Zweck gelten, ohne dass diese Eigenschaft von einer Bedingung an ganz
anderer Stelle abhängt.

---

### SF-08 · Kein CSRF-Token als zweite Schicht — **Niedrig** — akzeptiertes Restrisiko

`apps/api/src/auth/guards/origin-check.guard.ts`

Der `OriginCheckGuard` lässt zustandsändernde Requests **ohne** `Origin`-Header
passieren. Der CSRF-Schutz ruht damit auf zwei Annahmen: dass Browser bei
Cross-Site-Requests immer einen `Origin` senden, und auf `SameSite=Lax`.

**Nachweis:** `PATCH /me` ohne `Origin` erreicht die Validierung (400 statt 403);
mit fremdem Origin wird korrekt mit 403 geblockt.

**Bewertung:** Beide Annahmen halten bei aktuellen Browsern. Alle
zustandsändernden Endpunkte erwarten `Content-Type: application/json`, was
niemals ein „simple request" ist – ein solcher Request löst zwingend einen
Preflight aus und trägt einen `Origin`. Das bewusste Zulassen fehlender Origins
ermöglicht native Clients und `curl`.

**Empfehlung:** So belassen. Falls später ein Endpunkt formularkodierte Daten
annimmt, muss diese Entscheidung neu bewertet werden – dann wäre ein
Double-Submit-Token nötig. Die Doku beschreibt jetzt den tatsächlichen
Mechanismus statt eines nie implementierten Tokens.

---

### SF-22 · Audit-Log ohne Herkunft — **Niedrig** — behoben

`apps/api/src/audit/audit.service.ts`

Von 60 `audit.log()`-Aufrufstellen übergaben nur 3 eine IP – die beiden
Login-Aktionen und die Nutzung eines Backup-Codes. Bei allen übrigen Einträgen
stand `NULL` in der Spalte, obwohl das Feld existiert: `VIEW`/`EXPORT` von
Personendaten, `ANONYMIZE`, Rollenänderungen, Importe.

Damit fehlte ausgerechnet dort die Herkunft, wo das Audit-Log seinen Zweck hat.
Laut Threat Model (Angreifer 3) ist es die Maßnahme gegen ein kompromittiertes
Teamleiter-Konto – ohne IP lässt sich aber nicht unterscheiden, ob ein Zugriff
vom gewohnten Gerät kam oder von woanders. OWASP A09 (Logging Failures).

**Behebung:** Ein globaler Interceptor legt die Client-IP pro Request in einen
`AsyncLocalStorage`-Kontext (`src/audit/request-context.ts`), aus dem
`AuditService.log()` sie ausliest, wenn kein expliziter Wert übergeben wurde.
Alle 60 Aufrufstellen bleiben dadurch unverändert.

Verworfene Alternativen: Ein `REQUEST`-Scope für den `AuditService` hätte über
das `@Global()`-Modul auf praktisch den gesamten Provider-Graphen kaskadiert
(13 Services injizieren ihn direkt); die IP durch alle Signaturen zu reichen,
wären 60 Berührungspunkte, die bei jedem neuen Aufruf wieder vergessen werden
können – und die tokenbasierten Routen (Einladung, Passwort-Reset, Vertretung)
haben gar keinen `AuthUser`, an den man sie hängen könnte.

Nebenbei behoben: `test/utils/create-test-app.ts` baute den `FastifyAdapter`
ohne `trustProxy` und `bodyLimit` – die Datei soll laut eigenem Kommentar
`main.ts` exakt spiegeln, tat es aber nicht. Genau solche Abweichungen lassen
die Security-Schichten im Test ungeprüft.

---

## Weitere Beobachtungen (kein Handlungsbedarf)

- **iCal-Feed-Tokens laufen nie ab.** Bewusste Abwägung: Ein ablaufendes
  Kalender-Abo bricht ohne Vorwarnung. Das Token ist 128 Bit lang, gibt nur die
  eigenen Dienste preis und lässt sich jederzeit selbst rotieren.
- **`trustProxy: true` ist nicht an eine Bedingung geknüpft.** Hinter Caddy
  korrekt. Wäre die API je direkt erreichbar, ließe sich `X-Forwarded-For`
  fälschen und damit das IP-Rate-Limit umgehen. Im Compose-Stack ist der Port
  nicht veröffentlicht – bei abweichendem Deployment beachten.
- **`suggestForSlot` erzeugt intern einen synthetischen ADMIN-Principal**
  (`assignments.service.ts`). Heute nur aus serverseitigen Abläufen erreichbar,
  die vorher selbst prüfen – aber eine Falle für den nächsten Aufrufer.
- **Rechte wie `MANAGE_EVENTS` gelten instanzweit**, nicht pro Team: Wer ein
  Team leitet, kann Termine aller Teams bearbeiten. So dokumentiert und gewollt,
  aber die breiteste Rechtefläche unterhalb von Admin.
- **`pnpm audit`** meldete keine offenen Schwachstellen oberhalb `high`.

---

## Empfehlungen für den Betrieb

Nach dem Einspielen dieser Änderungen:

1. **`APP_URL` in der `.env` setzen** – sie fehlt im Produktions-Compose. Ohne
   sie startet die API nach diesem Update nicht mehr; das ist beabsichtigt,
   denn ein falscher Wert macht alle Mail-Links unbrauchbar.
2. **`REDIS_PASSWORD` setzen** (neu, siehe `.env.example`). Redis hält Sessions
   und die Job-Queue und war bisher nur durch die Netzwerktrennung geschützt.
3. **Secrets prüfen:** `COOKIE_SECRET` ≥ 32 Zeichen, `FIELD_ENCRYPTION_KEY`
   exakt 32 Byte base64 (`openssl rand -base64 32`). Die API sagt beim Start,
   was fehlt.
4. **Alle Nutzenden müssen sich nach dem Update einmalig neu anmelden**
   (Session-Cookies sind jetzt signiert).
5. **Image-Digests pinnen** statt `:latest` – die Digests stehen auf der
   Release-Seite, die Images sind mit cosign signiert.
6. **CrowdSec aktivieren**, falls verfügbar: Am Edge gibt es weiterhin kein
   Rate Limiting; das Limit der API ist prozesslokal und bei mehreren
   Instanzen entsprechend vervielfacht.
7. **HTTP→HTTPS-Weiterleitung prüfen** – aus der Prüfumgebung heraus war
   Klartext-HTTP nicht testbar (der Egress-Proxy unterbindet es).

### Eigene Instanz selbst prüfen

```bash
SAFE=1 BASE=https://ihre-domain.example node scripts/security/pentest.mjs
```

`SAFE=1` beschränkt den Lauf auf lesende Checks (Exposure, Security-Header,
Auth-Bypass) und ist gegen eine Produktivinstanz gefahrlos. Ohne `SAFE=1` legt
das Werkzeug Testdaten an und gehört ausschließlich in eine Testumgebung.

---

## Nachhaltigkeit

Damit die Befunde nicht zurückkehren:

- **`apps/api/test/security.int-spec.ts`** – ein Regressionstest je Befund.
  Gegenprobe durchgeführt: Ohne die Fixes fallen 8 der 14 Tests durch.
- **CI-Job `e2e`** führt `pentest.mjs` mit `SAFE=1` gegen das vollständige
  Compose-System aus – ein wieder öffentlich werdendes Swagger oder ein
  fehlender Auth-Guard bricht damit den Build.
- **`scripts/security/`** macht das Testlabor reproduzierbar.

**Gesamttestbestand nach dem Assessment:** 27 Suites, 204 Tests, alle grün.
