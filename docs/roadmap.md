# Roadmap

## Phase 1 – MVP ✅ (implementiert)

- Personenverwaltung mit RBAC, Field-Level-Sichtbarkeit, Privacy-Einstellungen,
  Datenexport, Löschung + Anonymisierung, verschlüsselte Notizen, Audit-Log
- Teams & Positionen mit Skills und Teamleiter-Scope
- Gottesdienst-Typen (RRULE) → Termine → Dienstpläne
- Zusage/Absage-Workflow mit Token-Links, Vorschlags-Engine (faire Verteilung),
  Absage-Alerts mit Ersatzvorschlägen
- Verfügbarkeiten (einmalig + wiederkehrend), Konfliktprüfung
- E-Mail-Erinnerungen (BullMQ), persönlicher iCal-Feed
- Import aus Elvanto/Planning Center (CSV + PCO-API) mit Dry-Run und Fehlerreport
- CI/CD: Lint/Tests/E2E-Smoke, CodeQL, Trivy, release-please, GHCR, cosign, SBOM

## Phase 2 – Gottesdienst-Inhalte (teilweise implementiert)

- **Gottesdienstablauf (Order of Service)** ✅: Ablaufplan pro Termin mit
  berechneten Uhrzeiten, Dauer, Verantwortlichen, Notizen und Liedern;
  Sortierung im Editor, druckfreundliche Ansicht (Browser-Druck/PDF).
  Bearbeitung durch Admins und Teamleitende.
- **Liederdatenbank** ✅: Songs mit Tonart, Tempo, CCLI-Nummer und
  Arrangements; Suche nach Titel/CCLI; Verknüpfung mit dem Ablaufplan.
- Noch offen (Tabellen existieren bereits im Prisma-Schema):
  - **Datei-Anhänge** (Noten, Slides) pro Lied/Ablaufpunkt (`Attachment`)
  - **Lied-Historie** („wann zuletzt gespielt“)
  - **Räume & Ressourcen:** Buchung pro Termin mit Konfliktprüfung
    (`Resource`, `ResourceBooking`)

## Phase 3 – Ausbau

- **Mobile-App** (React Native oder Flutter) – nutzt die bestehende REST-API
  unter `/api/v1` ohne Backend-Änderungen
- **Check-in für den Kinderdienst**
- **Multi-Gemeinde-Fähigkeit** (Mandanten)
- **OIDC/SSO** – das `AuthProvider`-Interface in `apps/api/src/auth` ist dafür
  vorbereitet (Sessions bleiben, nur die Identitätsprüfung wird austauschbar)
- **SMS-Benachrichtigungen** – als weiterer `NotificationChannel` neben SMTP
- **Weitere Import-Quellen** (ChurchTools, generisches CSV) über die
  bestehende Provider-Abstraktion in `apps/api/src/import`
