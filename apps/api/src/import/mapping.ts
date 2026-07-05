// Automatische Spaltenerkennung für die offiziellen CSV-Exporte von
// Elvanto (People-Export) und Planning Center (People-/Teams-Export).
//
// Die Erkennung ist eine Heuristik über normalisierte Header-Namen –
// der Admin bestätigt/ändert das Mapping anschließend in der UI.
// Unbekannte Spalten werden auf 'notes' gemappt (nichts geht verloren),
// erkennbar irrelevante auf 'ignore'.
import { ImportSource } from '@prisma/client';
import { ColumnMapping, TargetField } from './types';

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Synonyme pro Zielfeld; Reihenfolge = Priorität. Deckt Elvanto- und
// PCO-Header ab (deutsch + englisch, mit/ohne Unterstriche).
const SYNONYMS: Record<Exclude<TargetField, 'ignore' | 'notes'>, string[]> = {
  firstName: ['firstname', 'vorname', 'preferredname', 'givenname', 'nickname'],
  lastName: ['lastname', 'nachname', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'homeemail', 'workemail', 'emailadresse'],
  phone: [
    'mobile',
    'mobilephone',
    'mobilephonenumber',
    'phone',
    'phonenumber',
    'telefon',
    'homephone',
    'cellphone',
  ],
  birthday: ['birthday', 'birthdate', 'dateofbirth', 'geburtstag', 'geburtsdatum', 'dob'],
  address: ['address', 'homeaddress', 'homeaddressstreet', 'street', 'adresse', 'strasse'],
  teams: ['teams', 'team', 'groups', 'group', 'servicetypeteams', 'departments', 'volunteerteams'],
};

// Spalten, die typischerweise interne IDs/Metadaten sind – vorschlagsweise
// ignorieren (der Admin kann sie trotzdem auf 'notes' umstellen)
const IGNORE_HINTS = ['id', 'personid', 'remoteid', 'createdat', 'updatedat', 'status', 'archived'];

export function suggestMapping(headers: string[], _source: ImportSource): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<TargetField>();

  for (const header of headers) {
    const normalized = normalize(header);
    let target: TargetField = 'notes';

    if (IGNORE_HINTS.includes(normalized)) {
      target = 'ignore';
    } else {
      for (const [field, synonyms] of Object.entries(SYNONYMS) as [TargetField, string[]][]) {
        // Jedes Personen-Feld nur einmal vergeben ('teams'/'notes' dürfen
        // mehrfach vorkommen und werden zusammengeführt)
        if (taken.has(field) && field !== 'teams') continue;
        if (synonyms.includes(normalized)) {
          target = field;
          taken.add(field);
          break;
        }
      }
    }
    mapping[header] = target;
  }
  return mapping;
}

// Tolerantes Datums-Parsing für Geburtstage: ISO (PCO) und
// dd.mm.yyyy / dd/mm/yyyy (Elvanto-Exporte je nach Kontoeinstellung)
export function parseBirthday(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(trimmed);
  if (iso) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(trimmed);
  if (dmy) {
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}
