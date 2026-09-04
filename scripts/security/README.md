# Security-Werkzeuge

Werkzeuge für das wiederholbare Sicherheitstesten von ServeFlow. Ergebnis des
Assessments vom September 2026 ([docs/security-assessment-2026-09.md](../../docs/security-assessment-2026-09.md)).

| Datei           | Zweck                                                       |
| --------------- | ----------------------------------------------------------- |
| `pentest.mjs`   | Aktiver Sicherheitstest gegen eine laufende Instanz         |
| `mail-sink.mjs` | Minimaler SMTP-Fänger, damit Token-Flows testbar sind       |
| `lab-up.sh`     | Lokales Testlabor (Postgres, Redis, Mail-Sink, API) starten |
| `lab-down.sh`   | Testlabor wieder abbauen                                    |

## Schnellstart

```bash
scripts/security/lab-up.sh          # Postgres, Redis, Mail-Sink, API auf :3000
node scripts/security/pentest.mjs   # voller Testlauf gegen das Labor
scripts/security/lab-down.sh
```

## `pentest.mjs`

Prüft Dinge, die ein generischer Scanner nicht kennt: die Rollenmatrix
(ADMIN/LEADER/MEMBER), die Token-Flows (Einladung, Passwort-Reset, iCal) und die
serverseitige Field-Level-Sichtbarkeit. Jeder Check meldet `PASS`, `FAIL`, `INFO`
oder `SKIP` samt Belegtext; der Exit-Code ist 1, sobald ein `FAIL` auftritt.

**Zwei Modi:**

```bash
# Voll – legt Testdaten an, braucht die Seed-Logins.
# NUR gegen eine Testinstanz verwenden!
node scripts/security/pentest.mjs

# SAFE – nur lesende Checks (Exposure, Security-Header, Auth-Bypass).
# Für eine Produktivinstanz gedacht; so läuft der Test auch im CI.
SAFE=1 BASE=https://serveflow.example.org node scripts/security/pentest.mjs
```

**Umgebungsvariablen**

| Variable      | Default                          | Bedeutung                                  |
| ------------- | -------------------------------- | ------------------------------------------ |
| `BASE`        | `http://127.0.0.1:3000`          | Zu testende Instanz                        |
| `SAFE`        | –                                | `1` = nur lesende Checks                   |
| `APP_ORIGIN`  | `http://localhost:5173`          | Muss der `APP_URL` der Instanz entsprechen |
| `MAIL_API`    | `http://127.0.0.1:8025/messages` | HTTP-API des Mail-Sinks                    |
| `REPORT_JSON` | –                                | Pfad für einen JSON-Report                 |

### Zwei Eigenheiten beim vollen Lauf

**Rate Limiting.** `/auth/login` ist auf 10 Anfragen pro Minute begrenzt. Checks,
die absichtlich viele Login-Versuche brauchen (Account-Lockout, 2FA-Bruteforce),
laufen dadurch in ein `429` und melden dann `SKIP` statt eines wertlosen
Ergebnisses. Für diese Checks eine Instanz mit `NODE_ENV=test` starten – dort ist
der Throttler abgeschaltet (`app.module.ts`). Das Rate Limiting selbst wird
umgekehrt gegen eine normale Instanz geprüft.

**Mailversand.** Die Token-Flows brauchen die versendete Mail, weil in der
Datenbank nur der SHA-256-Hash des Tokens liegt. Mit `NODE_ENV=test` nutzt der
Mailer allerdings `jsonTransport` und verschickt nichts – Token-Checks brauchen
deshalb eine Instanz mit `NODE_ENV=development` oder `production` plus laufendem
Mail-Sink.

Kurz: Ein einzelner Lauf kann nicht alles abdecken. `lab-up.sh` startet daher
beide Varianten.

## `mail-sink.mjs`

Nimmt Mails per SMTP auf `:1025` an und gibt sie unter
`http://127.0.0.1:8025/messages` als JSON aus (`DELETE` leert den Puffer).
Ersetzt Mailpit dort, wo kein Docker verfügbar ist, und dekodiert
quoted-printable – sonst stünde in der Mail `token=3DAbc…` statt `token=Abc…`.

Kein AUTH, kein TLS, alles nur im Arbeitsspeicher: ausschließlich für Testlabore.
