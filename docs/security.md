# Security & Datenschutz

ServeFlow verarbeitet besonders schützenswerte Personendaten: Die bloße Mitgliedschaft
in einer Kirchgemeinde ist eine religiöse Zugehörigkeit (Art. 9 DSGVO / CH revDSG).
Dieses Dokument beschreibt das Threat Model und die daraus abgeleiteten Maßnahmen.

## Threat Model

### Angreifer 1: Externer Angreifer (kein Konto)

| Vektor                               | Maßnahme                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential Stuffing / Brute Force    | Argon2id-Hashing, Rate Limiting auf `/auth/*`, exponentieller Lockout-Backoff (gilt auch für falsche 2FA-Codes), generische Fehlermeldungen |
| Brute-Force auf Respond-/iCal-Tokens | 128-Bit-Zufallstokens (crypto.randomBytes), nur SHA-256-Hash in der DB, TTL + Single-Use, Rate Limiting auf `/respond/*`                    |
| SQL-Injection                        | Prisma-Parametrisierung, keine Raw-Queries mit String-Konkatenation                                                                         |
| XSS / Clickjacking                   | React-Escaping, CSP inkl. `frame-ancestors 'none'`, `base-uri`, `form-action`, `object-src` (Caddy) + Helmet, `X-Frame-Options: DENY`       |
| MitM                                 | TLS-only (Caddy mit Auto-HTTPS), HSTS, Cookies `Secure` + `HttpOnly` + `SameSite=Lax`                                                       |
| CSRF                                 | `SameSite=Lax`-Cookies + serverseitiger Origin-Check (`OriginCheckGuard`) für alle zustandsändernden Requests; signiertes Session-Cookie    |
| Geleakte Backups                     | Backups werden mit `age` verschlüsselt (siehe backup-restore.md)                                                                            |
| Automatisierte Web-Exploits/Scanner  | Optional CrowdSec AppSec (WAF) direkt in Caddy: prüft jede Anfrage vor dem Routing, Block → 403 (siehe unten)                               |
| Mass Assignment                      | DTO-Validierung mit `whitelist: true, forbidNonWhitelisted: true`                                                                           |

### Angreifer 2: Neugieriges Mitglied (gültiger Login, Rolle MEMBER)

| Vektor                                    | Maßnahme                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR (`GET /people/:id` fremder Personen) | Policy-Check auf jeder ID-Route; Field-Level-Filtering entfernt Kontaktdaten/Notizen serverseitig aus der Response (Feld fehlt, nicht `null`) |
| Enumeration von IDs                       | UUIDv4 statt inkrementeller IDs                                                                                                               |
| Abgreifen über Listen-Endpoints           | Listen liefern für MEMBER nur Name + Foto (wenn freigegeben)                                                                                  |
| iCal-Tokens anderer erraten               | 128-Bit-Token, rotierbar durch die Person selbst                                                                                              |
| Nachvollziehbarkeit                       | Audit-Log protokolliert VIEW/EXPORT von Personendaten                                                                                         |

### Angreifer 3: Kompromittiertes Teamleiter-Konto

| Vektor                                       | Maßnahme                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Massenexport von Kontaktdaten                | Kein Bulk-Export für Teamleiter; Sichtbarkeit strikt auf eigene Teammitglieder begrenzt                                                                 |
| Zugriff auf seelsorgerliche Notizen          | `PASTORAL`-Notizen sind Teamleitern grundsätzlich entzogen (nur Admin bzw. explizit berechtigte Rollen)                                                 |
| Manipulation von Plänen / Social Engineering | Audit-Log (append-only) macht jede Änderung nachvollziehbar; Admin kann Sessions einzelner Konten invalidieren                                          |
| Kontoübernahme erschweren                    | TOTP-2FA für Teamleiter und Admins (per Instanz-Setting erzwingbar)                                                                                     |
| Termine sabotieren (absagen, umlegen)        | `MANAGE_EVENTS` ist für alle konfigurierbaren Rollen opt-in; Serien-Konfiguration und `DELETE` bleiben Admin; Absagen ist reversibel und wird auditiert |
| Einteilungen unbemerkt löschen               | Das Entfernen einer besetzten Position antwortet mit `409` und verlangt ein ausdrückliches `force`                                                      |

### Angreifer 4: Empfänger weitergeleiteter E-Mails

| Vektor                             | Maßnahme                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missbrauch des Zusage/Absage-Links | Token zeigt nur Vorname + Termin (keine Kontaktdaten in URL oder Seite), Single-Purpose, Ablauf spätestens zum Termin, Aktion erfordert expliziten POST (kein GET-Side-Effect) |

## CrowdSec AppSec (optionaler WAF am Edge)

Das web-Image enthält Caddy mit einkompilierten CrowdSec-Bouncer-Modulen
(`http` + `appsec`, gepinnt auf ein Release). Aktiv wird davon nur etwas, wenn
deployment-seitig `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY` und
`CROWDSEC_APPSEC_URL` gesetzt sind (siehe `.env.example`) – ohne diese
Variablen startet Caddy mit unveränderter Konfiguration und ohne WAF.

Bewusst gewählte Ausfall-Semantik:

- **Start:** Eine beim Start nicht erreichbare LAPI verhindert den Start nicht
  (Soft-Fail, Modul-Default) – ein CrowdSec-Ausfall darf die Verfügbarkeit der
  Anwendung nicht mitreißen.
- **Laufzeit:** Ist die AppSec-Engine nicht erreichbar, werden Anfragen mit 5xx
  beantwortet (fail closed, Modul-Default). Ein stillschweigend ausgefallener
  WAF wäre für diese Datenklasse das größere Risiko; wer Verfügbarkeit über
  WAF-Abdeckung stellt, kann das per `appsec_fail_open` im Snippet
  `docker/caddy/crowdsec/global-on.caddyfile` umkehren.
- Vom WAF blockierte Anfragen enden mit **403**.

Das ebenfalls einkompilierte `crowdsec`-Handler-Modul (Durchsetzen von
IP-Bann-Entscheidungen direkt in Caddy) ist noch nicht aktiviert – die
Log-basierte Erkennung samt Remediation läuft heute außerhalb dieses Stacks.

## Verschlüsselung sensibler Felder at rest

Notizen (`GENERAL` und `PASTORAL`) werden applikationsseitig mit **AES-256-GCM**
verschlüsselt (`FIELD_ENCRYPTION_KEY`, pro Datensatz eigener IV, versioniertes
Key-Prefix für spätere Rotation).

**Begründung:** Notizen sind die sensibelsten Freitextdaten; App-Level-Verschlüsselung
schützt gegen DB-Dump-Leaks und direkten DB-Zugriff. Kontaktdaten bleiben
unverschlüsselt, weil sie gefiltert/gesucht/exportiert werden müssen – ihr Schutz
erfolgt über RBAC, Field-Level-Filtering und verschlüsselte Backups.
Festplatten-/DB-Verschlüsselung ist zusätzlich Betreiber-Verantwortung.

## Startzeit-Prüfungen der Konfiguration

Mit `NODE_ENV=production` verweigert die API den Start, wenn:

- `COOKIE_SECRET` oder `FIELD_ENCRYPTION_KEY` noch den `CHANGE_ME`-Platzhalter tragen,
- `FIELD_ENCRYPTION_KEY` nicht exakt 32 Byte base64 ist,
- `COOKIE_SECRET` kürzer als 32 Zeichen ist,
- `APP_URL` auf eine echte Domain ohne `https://` zeigt (localhost ist erlaubt,
  weil der E2E-Stack dieselben Images bewusst ohne TLS fährt).

**Warum fail-fast:** Zuvor startete die API mit einem unbrauchbaren
Verschlüsselungs-Key fehlerfrei und lieferte erst beim ersten Zugriff auf ein
verschlüsseltes Feld (2FA-Einrichtung, Notiz) einen HTTP 500 – also erst dann,
wenn eine echte Person die Funktion nutzen wollte.

## Sicherheitstests

Zwei sich ergänzende Ebenen:

- **`apps/api/test/security.int-spec.ts`** – Regressionstests zu den Befunden des
  Assessments (2FA-Lockout, TOTP-Replay, Token-Purpose, CSV-Injection,
  iCal-Injection, Cookie-Signatur, Datumsvalidierung). Laufen in der normalen
  Testsuite mit.
- **`scripts/security/pentest.mjs`** – aktiver Test gegen eine laufende Instanz.
  `SAFE=1` beschränkt ihn auf lesende Checks (Exposure, Header, Auth-Bypass) und
  ist damit auch gegen eine Produktivinstanz gefahrlos; in dieser Form läuft er
  im CI-Job `e2e`. Details: [`scripts/security/README.md`](../scripts/security/README.md).

Vollständiger Bericht: [security-assessment-2026-09.md](security-assessment-2026-09.md)

## OWASP Top 10 Checkliste (bei jedem Review abhaken)

Stand des Assessments vom September 2026 (siehe security-assessment-2026-09.md).
Bei jedem Review erneut prüfen – ein Haken gilt nur für den damals geprüften Stand.

- [x] A01 Broken Access Control – Negativtests pro Rolle vorhanden und grün (teams/team-roles/people/scheduling int-specs, Pentest-Rollenmatrix)
- [x] A02 Cryptographic Failures – argon2id, AES-256-GCM mit fixer Auth-Tag-Länge, TLS-only, keine eigenen Krypto-Konstrukte
- [x] A03 Injection – nur parametrisierte Prisma-Queries, DTO-Validierung aktiv, CSV-Formel-Injection entschärft, iCal-Escaping inkl. CR
- [x] A04 Insecure Design – Threat Model in diesem Dokument aktuell
- [x] A05 Security Misconfiguration – Security-Header inkl. CSP-Direktiven, Swagger in Produktion aus, Secrets werden beim Start validiert, Container ohne Zusatzrechte
- [ ] A06 Vulnerable Components – Dependabot-PRs gemergt, Trivy-Image-Scan grün? (laufend)
- [x] A07 Auth Failures – Rate Limiting, Session-Invalidierung, Lockout auch für 2FA-Codes, TOTP-Replay-Schutz
- [x] A08 Integrity Failures – alle Actions SHA-gepinnt, Images signiert (cosign)
- [ ] A09 Logging Failures – Audit-Log für neue Personendaten-Zugriffe erweitert? (pro Feature prüfen; `ip` wird bisher nur bei Login-Aktionen erfasst)
- [x] A10 SSRF – keine serverseitigen Requests auf Nutzer-URLs (PCO-Import: feste API-Basis-URL, Paginierungs-Links werden gegen diese geprüft)
