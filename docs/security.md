# Security & Datenschutz

ServeFlow verarbeitet besonders schützenswerte Personendaten: Die bloße Mitgliedschaft
in einer Kirchgemeinde ist eine religiöse Zugehörigkeit (Art. 9 DSGVO / CH revDSG).
Dieses Dokument beschreibt das Threat Model und die daraus abgeleiteten Maßnahmen.

## Threat Model

### Angreifer 1: Externer Angreifer (kein Konto)

| Vektor                               | Maßnahme                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Credential Stuffing / Brute Force    | Argon2id-Hashing, Rate Limiting auf `/auth/*`, exponentieller Lockout-Backoff, generische Fehlermeldungen („E-Mail oder Passwort falsch") |
| Brute-Force auf Respond-/iCal-Tokens | 128-Bit-Zufallstokens (crypto.randomBytes), nur SHA-256-Hash in der DB, TTL + Single-Use, Rate Limiting auf `/respond/*`                  |
| SQL-Injection                        | Prisma-Parametrisierung, keine Raw-Queries mit String-Konkatenation                                                                       |
| XSS / Clickjacking                   | React-Escaping, CSP + Security-Header (Caddy + Helmet), `X-Frame-Options: DENY`                                                           |
| MitM                                 | TLS-only (Caddy mit Auto-HTTPS), HSTS, Cookies `Secure` + `HttpOnly` + `SameSite=Lax`                                                     |
| CSRF                                 | SameSite-Cookies + Double-Submit-Token für zustandsändernde Requests                                                                      |
| Geleakte Backups                     | Backups werden mit `age` verschlüsselt (siehe backup-restore.md)                                                                          |
| Mass Assignment                      | DTO-Validierung mit `whitelist: true, forbidNonWhitelisted: true`                                                                         |

### Angreifer 2: Neugieriges Mitglied (gültiger Login, Rolle MEMBER)

| Vektor                                    | Maßnahme                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR (`GET /people/:id` fremder Personen) | Policy-Check auf jeder ID-Route; Field-Level-Filtering entfernt Kontaktdaten/Notizen serverseitig aus der Response (Feld fehlt, nicht `null`) |
| Enumeration von IDs                       | UUIDv4 statt inkrementeller IDs                                                                                                               |
| Abgreifen über Listen-Endpoints           | Listen liefern für MEMBER nur Name + Foto (wenn freigegeben)                                                                                  |
| iCal-Tokens anderer erraten               | 128-Bit-Token, rotierbar durch die Person selbst                                                                                              |
| Nachvollziehbarkeit                       | Audit-Log protokolliert VIEW/EXPORT von Personendaten                                                                                         |

### Angreifer 3: Kompromittiertes Teamleiter-Konto

| Vektor                                       | Maßnahme                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Massenexport von Kontaktdaten                | Kein Bulk-Export für Teamleiter; Sichtbarkeit strikt auf eigene Teammitglieder begrenzt                        |
| Zugriff auf seelsorgerliche Notizen          | `PASTORAL`-Notizen sind Teamleitern grundsätzlich entzogen (nur Admin bzw. explizit berechtigte Rollen)        |
| Manipulation von Plänen / Social Engineering | Audit-Log (append-only) macht jede Änderung nachvollziehbar; Admin kann Sessions einzelner Konten invalidieren |
| Kontoübernahme erschweren                    | TOTP-2FA für Teamleiter und Admins (per Instanz-Setting erzwingbar)                                            |

### Angreifer 4: Empfänger weitergeleiteter E-Mails

| Vektor                             | Maßnahme                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missbrauch des Zusage/Absage-Links | Token zeigt nur Vorname + Termin (keine Kontaktdaten in URL oder Seite), Single-Purpose, Ablauf spätestens zum Termin, Aktion erfordert expliziten POST (kein GET-Side-Effect) |

## Verschlüsselung sensibler Felder at rest

Notizen (`GENERAL` und `PASTORAL`) werden applikationsseitig mit **AES-256-GCM**
verschlüsselt (`FIELD_ENCRYPTION_KEY`, pro Datensatz eigener IV, versioniertes
Key-Prefix für spätere Rotation).

**Begründung:** Notizen sind die sensibelsten Freitextdaten; App-Level-Verschlüsselung
schützt gegen DB-Dump-Leaks und direkten DB-Zugriff. Kontaktdaten bleiben
unverschlüsselt, weil sie gefiltert/gesucht/exportiert werden müssen – ihr Schutz
erfolgt über RBAC, Field-Level-Filtering und verschlüsselte Backups.
Festplatten-/DB-Verschlüsselung ist zusätzlich Betreiber-Verantwortung.

## OWASP Top 10 Checkliste (bei jedem Review abhaken)

- [ ] A01 Broken Access Control – Negativtests pro Rolle vorhanden und grün?
- [ ] A02 Cryptographic Failures – argon2id, AES-256-GCM, TLS-only, keine eigenen Krypto-Konstrukte?
- [ ] A03 Injection – nur Prisma-Queries, DTO-Validierung aktiv?
- [ ] A04 Insecure Design – Threat Model für neue Features aktualisiert?
- [ ] A05 Security Misconfiguration – Security-Header, keine Default-Credentials, Trivy-Config-Scan grün?
- [ ] A06 Vulnerable Components – Dependabot-PRs gemergt, Trivy-Image-Scan grün?
- [ ] A07 Auth Failures – Rate Limiting, Session-Invalidierung, 2FA funktionsfähig?
- [ ] A08 Integrity Failures – Actions SHA-gepinnt, Images signiert (cosign)?
- [ ] A09 Logging Failures – Audit-Log für neue Personendaten-Zugriffe erweitert?
- [ ] A10 SSRF – keine serverseitigen Requests auf Nutzer-URLs (PCO-Import: nur feste API-Basis-URL)?
