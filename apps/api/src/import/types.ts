// Gemeinsame Typen des Import-Moduls.
//
// Provider-Abstraktion: Jede Quelle (Elvanto-CSV, PCO-CSV, PCO-API,
// später ChurchTools etc.) liefert am Ende normalisierte
// ImportPersonRecords – die gesamte Duplikat-/Merge-/Upsert-Pipeline
// dahinter ist quellenunabhängig.

export const TARGET_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'birthday',
  'address',
  'teams', // Teamnamen, komma-/semikolongetrennt
  'ignore', // Spalte bewusst verwerfen
  'notes', // in importNotes übernehmen
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

// Quellspalte → Zielfeld, vom Admin in der Mapping-UI bestätigt
export type ColumnMapping = Record<string, TargetField>;

export interface ImportPersonRecord {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  birthday?: Date;
  address?: string;
  teams: string[];
  // Alles, was nicht abbildbar ist, landet als "Spalte: Wert" in
  // importNotes statt verworfen zu werden (Anforderung Migrationspfad)
  extraNotes: string[];
}

export type RowOutcome = 'CREATED' | 'UPDATED' | 'MERGED' | 'SKIPPED' | 'ERROR';

export interface RowPlan {
  rowNumber: number;
  outcome: RowOutcome;
  personId?: string;
  error?: string;
  record?: ImportPersonRecord;
  raw: Record<string, string>;
}
