// Parser für Song-Dateien aus SongSelect-Downloads (und kompatible):
// ChordPro (.cho/.chopro/.pro, Direktiven in {…}) und die reinen
// Text-Exporte von SongSelect (Titel in der ersten Zeile, CCLI-Nummer
// und Copyright im Fußblock). Bewusst eine pure Funktion ohne DB/DI –
// die Heuristiken sind vollständig per Unit-Test abgedeckt.
//
// Hintergrund: Eine offizielle SongSelect-API gibt es für neue Anbieter
// nicht mehr (Partnerprogramm eingestellt) – der sanktionierte Weg ist,
// dass SongSelect-Abonnenten ihre Dateien herunterladen und hier
// importieren.

export interface ParsedSong {
  title: string;
  ccliNumber?: string;
  key?: string;
  tempoBpm?: number;
  author?: string;
  copyright?: string;
  lyrics: string;
}

export class SongFileParseError extends Error {}

const CHORDPRO_EXTENSIONS = ['.cho', '.chopro', '.pro', '.chordpro'];

// "CCLI Song # 7011351", "CCLI-Liednummer 7011351", "CCLI: 7011351" …
const CCLI_NUMBER = /CCLI[ -]?(?:Song|Lied)?[ -]?(?:Nr\.|#|Nummer|Number)?\s*[:#]?\s*(\d{4,8})/i;

// SongSelect-Fußzeilen, die nicht in die Songtexte gehören
const BOILERPLATE = [
  /^For use solely with the SongSelect/i,
  /^Zur Verwendung ausschlie(ß|ss)lich (mit|gem(ä|ae)ss?)/i,
  /^All rights reserved/i,
  /^Alle Rechte vorbehalten/i,
  /^www\.ccli\.com/i,
  /^CCLI[ -]?(Licence|License|Lizenz)/i,
  /^Terms of Use/i,
];

export function parseSongFile(content: string, filename: string): ParsedSong {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lowerName = filename.toLowerCase();
  const isChordPro =
    CHORDPRO_EXTENSIONS.some((ext) => lowerName.endsWith(ext)) || /\{(title|t)\s*:/i.test(text);
  return isChordPro ? parseChordPro(text) : parseSongSelectText(text);
}

function directive(text: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const match = text.match(new RegExp(`\\{${name}\\s*:\\s*([^}]+)\\}`, 'i'));
    if (match) return match[1].trim();
  }
  return undefined;
}

function parseChordPro(text: string): ParsedSong {
  const title = directive(text, 'title', 't');
  if (!title) {
    throw new SongFileParseError('ChordPro-Datei ohne {title:}-Direktive');
  }
  const tempoRaw = directive(text, 'tempo');
  const tempo = tempoRaw ? Number.parseInt(tempoRaw, 10) : undefined;
  const ccliDirective = directive(text, 'ccli');
  const ccliFromText = text.match(CCLI_NUMBER)?.[1];
  return {
    title,
    ccliNumber: ccliDirective?.match(/\d{4,8}/)?.[0] ?? ccliFromText,
    key: directive(text, 'key'),
    tempoBpm: tempo && Number.isFinite(tempo) ? tempo : undefined,
    author: directive(text, 'artist', 'author', 'composer'),
    copyright: directive(text, 'copyright'),
    // Die ChordPro-Quelle bleibt unverändert erhalten – sie ist das
    // Austauschformat (Akkorde inline, Direktiven inklusive).
    lyrics: text.trim(),
  };
}

function parseSongSelectText(text: string): ParsedSong {
  const lines = text.split('\n');
  const firstContent = lines.findIndex((line) => line.trim() !== '');
  if (firstContent === -1) {
    throw new SongFileParseError('Leere Datei');
  }
  const title = lines[firstContent].trim();

  const ccliNumber = text.match(CCLI_NUMBER)?.[1];
  // SongSelect setzt die Autorenzeile direkt unter den Titel. Beginnt
  // dort schon der Songtext (Abschnittslabel), gibt es keine Autoren.
  const secondLine = lines[firstContent + 1]?.trim() || undefined;
  const sectionLabel =
    /^(Verse|Chorus|Bridge|Strophe|Refrain|Pre-Chorus|Intro|Outro|Tag|Ending|Coda)\b/i;
  const author = secondLine && !sectionLabel.test(secondLine) ? secondLine : undefined;

  // Fußblock: Copyright-Zeilen (©/Copyright) einsammeln, Boilerplate und
  // CCLI-Zeilen aus dem Songtext heraushalten
  const copyrightLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines.slice(firstContent + (author ? 2 : 1))) {
    const trimmed = line.trim();
    if (/^(©|\(c\)|Copyright)/i.test(trimmed)) {
      copyrightLines.push(trimmed);
      continue;
    }
    if (CCLI_NUMBER.test(trimmed) || BOILERPLATE.some((pattern) => pattern.test(trimmed))) {
      continue;
    }
    bodyLines.push(line);
  }

  return {
    title,
    ccliNumber,
    author,
    copyright: copyrightLines.length ? copyrightLines.join(' ') : undefined,
    lyrics: bodyLines.join('\n').trim(),
  };
}
