# Roadmap

Priorisierung auf Basis des Feature-Vergleichs mit Elvanto und Planning
Center: [vergleich-alternativen.md](vergleich-alternativen.md).

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

## Phase 2 – Gottesdienst-Inhalte & Scheduling-Ausbau (in Arbeit)

Bereits umgesetzt:

- **Gottesdienstablauf (Order of Service)** ✅: Ablaufplan pro Termin mit
  berechneten Uhrzeiten, Dauer, Verantwortlichen, Notizen und Liedern;
  Sortierung im Editor, druckfreundliche Ansicht (Browser-Druck/PDF).
  Bearbeitung durch Admins und Teamleitende.
- **Liederdatenbank** ✅: Songs mit Tonart, Tempo, CCLI-Nummer und
  Arrangements; Suche nach Titel/CCLI; Verknüpfung mit dem Ablaufplan.
- **Vertretung (Swap & Replace)** ✅: Eingeteilte fragen selbst eine geeignete
  Vertretung an (Token-Link ohne Login); bei Zusage wandert die Einteilung
  automatisch über, Teamleitung wird informiert
- **Selbst-Eintragung (Signup)** ✅: Teamleitende geben Slots frei, passende
  Mitglieder tragen sich über „Offene Dienste" selbst ein (zählt als Zusage)

Als Nächstes (Reihenfolge = Priorisierung aus dem Vergleich):

1. **Plan-Vorlagen & „Vorwoche kopieren"**: Ablauf + Besetzungs-Vorlagen je
   Gottesdienst-Typ; Rotations-Vorlagen
2. **Probe-/Zusatzzeiten** pro Termin (Probe, Stellprobe, mehrere
   Gottesdienstzeiten)
3. **Songtexte & Akkorde**: ChordPro-Import, Anzeige mit Transposition in
   jede Tonart; **Lied-Historie** („wann zuletzt gespielt")
4. **Datei-Storage + Anhänge** (Noten-PDFs, MP3s, Slides pro
   Lied/Ablaufpunkt; Personenfotos) – `Attachment`-Tabelle existiert
5. **Auto-Einteilung**: alle offenen Slots eines Termins per Klick über die
   Vorschlags-Engine besetzen; Absagen optional automatisch neu besetzen
6. **Live-Ansicht**: während des Gottesdienstes durch den Ablauf steppen
   (Timer, aktueller Punkt)
7. **Räume & Ressourcen**: Buchung pro Termin mit Konfliktprüfung
   (`Resource`, `ResourceBooking` existieren im Schema)

## Phase 3 – Ausbau

- **Matrix-Ansicht**: viele Termine nebeneinander planen, Einladungen
  gesammelt versenden
- **Team-Kommunikation**: Rundmail an Team/alle; SMS als weiterer
  `NotificationChannel` neben SMTP
- **Custom Fields & Personen-Kategorien**; **Familien/Haushalte** (auch
  Voraussetzung für Familien-Einteilung und Check-in)
- **Formulare & Workflows** (Datenerfassung in die Personen-DB,
  Neulinge-Prozesse); **Anwesenheit & Reports**
- **Check-in für den Kinderdienst** (Sicherheitscodes, Etiketten)
- **Kleingruppen** (getrennt von Dienst-Teams)
- **Events mit Anmeldung** und öffentlicher Kalender
- **Mobile-App** (React Native oder Flutter) – nutzt die bestehende REST-API
  unter `/api/v1` ohne Backend-Änderungen
- **Multi-Gemeinde-Fähigkeit** (Mandanten)
- **OIDC/SSO** – das `AuthProvider`-Interface in `apps/api/src/auth` ist dafür
  vorbereitet (Sessions bleiben, nur die Identitätsprüfung wird austauschbar)
- **Webhooks** für Integrationen
- **Weitere Import-Quellen** (ChurchTools, generisches CSV) über die
  bestehende Provider-Abstraktion in `apps/api/src/import`

## Bewusst nicht geplant

- **Spendenverwaltung (Giving)** – allenfalls Schnittstellen zu bestehenden
  Lösungen; Begründung im [Vergleich](vergleich-alternativen.md)
- **Background Checks** (US-spezifisch)
