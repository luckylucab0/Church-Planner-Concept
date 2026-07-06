# Feature-Vergleich: ServeFlow vs. Elvanto und Planning Center

Stand: Juli 2026. Verglichen werden Elvanto (heute Teil von Tithe.ly ChMS) und
Planning Center (Services + Produkt-Suite) mit dem aktuellen Stand von
ServeFlow. Ziel: Lücken sichtbar machen und die [Roadmap](roadmap.md)
priorisieren – nicht jede Lücke ist ein Ziel (siehe „Bewusst außerhalb des
Scopes").

## Wo ServeFlow gleichauf oder voraus ist

| Bereich                                             | ServeFlow | Elvanto | Planning Center |
| --------------------------------------------------- | :-------: | :-----: | :-------------: |
| Self-hosted, Daten bleiben in der Gemeinde          |    ✅     |   ❌    |       ❌        |
| Feingranulare Privatsphäre (Field-Level, Opt-in)    |    ✅     |   ⚠️    |       ⚠️        |
| Append-only-Audit-Log, DSGVO-Export/-Anonymisierung |    ✅     |   ⚠️    |       ⚠️        |
| Teams/Positionen/Skills, Teamleiter-Scope           |    ✅     |   ✅    |       ✅        |
| Wiederkehrende Termine (RRULE) + Dienstpläne        |    ✅     |   ✅    |       ✅        |
| Zusage/Absage per Mail-Link (ohne Login)            |    ✅     |   ✅    |       ✅        |
| Faire Einteilungs-Vorschläge (erklärt „warum")      |    ✅     |   ⚠️    |       ✅        |
| Abwesenheiten einmalig + wiederkehrend              |    ✅     |   ✅    |       ✅        |
| Erinnerungen, iCal-Abo                              |    ✅     |   ✅    |       ✅        |
| Ablaufplan mit Uhrzeiten, Liedern, CCLI, Druck      |    ✅     |   ✅    |       ✅        |
| Liederdatenbank mit Arrangements                    |    ✅     |   ✅    |       ✅        |
| Offene, dokumentierte REST-API                      |    ✅     |   ✅    |       ✅        |
| Zweisprachig Deutsch/Englisch                       |    ✅     |   ⚠️    |       ❌        |

## Lücken: Einteilung/Scheduling

| Fehlende Funktion                            | Was die anderen machen                                                                                                                     | Einordnung für ServeFlow                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Swap & Replace**                           | Eingeteilte tauschen ihren Dienst selbst mit anderen oder fragen selbst eine Vertretung an; die Teamleitung wird nur informiert            | Größte Workflow-Lücke; baut komplett auf Assignments + Vorschlags-Engine auf |
| **Auto-Einteilung**                          | PCO besetzt alle offenen Positionen per Klick (nach „zuletzt dran", Präferenzen, Blockouts); Absagen können automatisch neu besetzt werden | Scoring existiert bereits – fehlt nur „alle offenen Slots besetzen"-Aktion   |
| **Selbst-Eintragung (Signup Sheets)**        | Mitglieder tragen sich selbst in offene Positionen ein                                                                                     | Gut geeignet für Kaffee/Aufbau-Dienste                                       |
| **Plan-/Team-Vorlagen, „Vorwoche kopieren"** | Vorlagen mit Ablauf + Besetzung; Rotations-Templates                                                                                       | ServeFlow hat nur Positions-Templates pro Gottesdienst-Typ                   |
| **Mehrere Zeiten pro Termin**                | Probe, Stellprobe, 1./2. Gottesdienst an einem Plan                                                                                        | Termine haben aktuell genau eine Start-/Endzeit                              |
| **Matrix-Ansicht**                           | Viele Termine nebeneinander planen, Einladungen gesammelt versenden                                                                        | Relevant ab ~4 Diensten/Monat                                                |
| **Präferenzen/Haushalte**                    | „Max. n× pro Monat", bevorzugte Zeit, Familien gemeinsam einteilen                                                                         | Braucht Familien-/Haushaltsmodell (s. u.)                                    |

## Lücken: Worship-Inhalte

| Fehlende Funktion                       | Was die anderen machen                                                     | Einordnung für ServeFlow                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Songtexte & Akkorde + Transposition** | Lyrics/Chord-Charts pro Arrangement, Live-Transposition in jede Tonart     | Naheliegendste Erweiterung der Liederdatenbank; ChordPro-Format als Basis                         |
| **SongSelect-Integration**              | Lieder samt Text/Akkorden direkt aus CCLI SongSelect importieren           | ⚠️ SongSelect-API ist lizenz-/partnerschaftspflichtig – realistisch ist manueller ChordPro-Import |
| **Datei-Anhänge/Medien**                | Noten-PDFs, MP3s, Slides pro Lied/Ablaufpunkt                              | `Attachment`-Tabelle existiert; braucht Datei-Storage (Volume) im Compose-Setup                   |
| **Proben-/Notenansicht (Music Stand)**  | Tablet-Ansicht für die Band, Audio-Player, Fußpedal-Blättern               | Großes eigenes Modul; erst nach Anhängen sinnvoll                                                 |
| **Live-Ansicht (Services LIVE)**        | Während des Gottesdienstes durch den Ablauf steppen, Timer, „wer ist dran" | Direkt auf dem Ablaufplan aufbaubar                                                               |
| **Lied-Historie**                       | „Wann zuletzt gespielt, wie oft dieses Jahr"                               | Daten liegen in den Ablaufpunkten – reine Auswertung                                              |

## Lücken: Personenverwaltung

- **Custom Fields / Personen-Kategorien** (Elvanto-Kernfeature)
- **Familien/Haushalte** als Struktur (Voraussetzung für Familien-Einteilung
  und Check-in)
- **Foto-Upload** (Feld `photoUrl` existiert, aber kein Upload/Storage)
- **Formulare**, die direkt in die Personendatenbank schreiben, und
  **Workflows/Prozesse** (z. B. Neulinge-Pipeline)
- **Anwesenheit/Zählungen** und frei konfigurierbare **Reports**

## Lücken: weitere ChMS-Module

- **Kinder-Check-in** mit Sicherheitscodes/Etiketten (Roadmap Phase 3)
- **Kleingruppen** (getrennt von Dienst-Teams, mit Anwesenheit)
- **Events mit Anmeldung/Registrierung**, öffentlicher Kalender,
  **Raum-/Ressourcen-Buchung** (`Resource`-Tabellen sind vorbereitet)
- **Rundmails/SMS an Teams/Gruppen** – das `NotificationChannel`-Interface ist
  für SMS vorbereitet; es fehlt „Nachricht an Team senden"
- **Mitglieder-App** (à la Church Center; ServeFlow-Web ist mobile-first,
  native App = Phase 3), **Multi-Campus**, **Webhooks/Zapier**

## Bewusst außerhalb des Scopes

- **Spendenverwaltung (Giving):** Kern-Geschäftsmodell von Tithe.ly/PCO; für
  ein self-hosted Datenschutz-Tool bewusst nicht geplant (allenfalls
  Schnittstellen zu bestehenden Spendenlösungen)
- **Background Checks:** US-spezifisches Feature ohne Entsprechung im
  DACH-Kontext

## Priorisierungs-Empfehlung (Nutzen pro Aufwand)

1. **Swap & Replace + Selbst-Eintragung** – schließt die größte
   Workflow-Lücke, baut vollständig auf Vorhandenem auf
2. **Plan-Vorlagen / „Vorwoche kopieren" + Probe-Zeiten**
3. **Songtexte/Akkorde mit Transposition (ChordPro) + Lied-Historie**
4. **Datei-Storage** (Noten, Anhänge, Personenfotos) – Grundlage für
   Medien-Features und Check-in-Etiketten
5. **Auto-Einteilung**, später **Matrix-Ansicht** und **Live-Ansicht**
6. Danach die großen Module: Check-in, Gruppen, Event-Anmeldung,
   Team-Kommunikation

Quellen (abgerufen Juli 2026): [Planning Center Services](https://www.planningcenter.com/services),
[PCO Auto-Schedule](https://help.planningcenter.com/en/142881-auto-schedule-your-team.html),
[PCO Auto-Reschedule Declines](https://www.planningcenter.com/blog/2024/09/auto-reschedule-declined-volunteer-requests-in-services),
[PCO Signup Sheets](https://help.planningcenter.com/en/142882-schedule-with-signup-sheets.html),
[PCO Scheduling-Templates](https://help.planningcenter.com/en/142876-set-up-scheduling-templates.html),
[PCO Blockouts](https://help.planningcenter.com/en/142872-manage-blockout-dates.html),
[Music Stand](https://www.planningcenter.com/music-stand),
[Elvanto Features](https://www.elvanto.com/features/),
[Elvanto Worship Planning & Volunteers](https://www.elvanto.com/us/features/all/worship-planning-volunteers/)
