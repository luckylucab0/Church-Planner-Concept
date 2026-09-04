// Schutz vor CSV Formula Injection (auch "CSV Injection" genannt).
//
// Problem: Excel, LibreOffice Calc und Google Sheets interpretieren eine
// Zelle, die mit = + - @ beginnt, als FORMEL – nicht als Text. Eine
// importierte Zelle wie `=cmd|' /C calc'!A0` wird beim Öffnen des
// Fehlerreports also auf dem Rechner der Admin-Person ausgeführt bzw.
// löst zumindest eine Rückfrage aus, die zur Ausführung führen kann.
// Das korrekte CSV-Quoting von csv-stringify hilft dagegen NICHT: Die
// Tabellenkalkulation entfernt die Anführungszeichen beim Parsen und
// wertet den Inhalt danach aus.
//
// Betroffen ist jede CSV, die von Nutzern stammende Daten zurückgibt –
// bei ServeFlow der Import-Fehlerreport, der die hochgeladenen Rohzeilen
// spiegelt.
//
// Lösung (OWASP-Empfehlung): Ein einfaches Anführungszeichen voranstellen.
// Tabellenkalkulationen behandeln die Zelle dann als Text; der Wert bleibt
// vollständig lesbar.

// Führende Steuerzeichen (Tab, CR, LF) zählen mit: Sie werden von manchen
// Programmen verworfen, wodurch das dahinterliegende = wieder an den Anfang
// rückt.
const DANGEROUS_START = /^[\t\r\n ]*[=+\-@]/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return DANGEROUS_START.test(text) ? `'${text}` : text;
}

// Bequemlichkeit für ganze Zeilen: entschärft alle Werte eines Objekts.
export function sanitizeCsvRow(row: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, sanitizeCsvCell(value)]),
  );
}
