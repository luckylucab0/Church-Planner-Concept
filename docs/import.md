# Datenimport (Elvanto / Planning Center)

Der Import-Assistent (Admin-Bereich → Datenimport) migriert Personen- und
Teamdaten aus Elvanto und Planning Center. Es wird **nie ohne Vorschau
geschrieben**.

## Ablauf

1. **Export erstellen**
   - Elvanto: People → Export → CSV
   - Planning Center: People → Lists/Export → CSV
2. **Hochladen**: Quelle wählen, CSV auswählen. Die Spalten werden
   automatisch erkannt (Heuristik über Header-Namen).
3. **Mapping prüfen**: Quellspalte → Zielfeld. Nicht abbildbare Spalten
   gehen auf „In Import-Notizen übernehmen" – sie landen im Feld
   `importNotes` der Person statt verloren zu gehen.
4. **Dry-Run**: Vorschau, was passieren würde (angelegt / aktualisiert /
   übersprungen / Fehler). Noch keine Änderung in der Datenbank.
5. **Import ausführen**: fehlerhafte Zeilen brechen den Import nicht ab,
   sondern erscheinen im herunterladbaren **Fehlerreport (CSV)**.

## Duplikat-Erkennung & Merge

- **Primär:** E-Mail (case-insensitive) → Ergebnis `UPDATED`
- **Fallback:** Vorname + Nachname + Geburtsdatum → Ergebnis `MERGED`
- **Merge-Strategie:** Bestehende, gepflegte Werte gewinnen immer – der
  Import füllt nur leere Felder auf und hängt neue Import-Notizen an.

## Teams

Eine auf „Teams" gemappte Spalte wird an `,`/`;` gesplittet. Teams werden
per Name gefunden oder neu angelegt, Mitgliedschaften idempotent gesetzt.

## Planning-Center-API (optional)

`POST /api/v1/admin/import/pco-api` mit `appId` + `secret`
(Personal Access Token von https://api.planningcenteronline.com) lädt
Personen inkl. E-Mail/Telefon direkt über die REST-API und erzeugt daraus
einen normalen Import-Job – Dry-Run und Bestätigung laufen identisch zum
CSV-Weg. Die Provider-Abstraktion (`src/import/`) ist bewusst so
geschnitten, dass weitere Quellen (z. B. ChurchTools, generisches CSV)
nur einen neuen Provider brauchen (Phase 3).

## Audit & Datenschutz

Jeder Upload und jede Ausführung erscheint im Audit-Log
(Aktion `IMPORT`, inkl. Zusammenfassung). Die hochgeladenen Rohzeilen
werden pro Job in der Datenbank gespeichert (Fehlerreport) – Jobs können
nach Abschluss gelöscht werden, wenn die Rohdaten nicht aufbewahrt werden
sollen.
