import { sanitizeCsvCell, sanitizeCsvRow } from './csv-safe';

describe('sanitizeCsvCell', () => {
  // Diese vier Zeichen leiten in Excel/LibreOffice/Google Sheets eine
  // Formel ein – genau darum geht es bei CSV Formula Injection.
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('entschärft "%s"', (value) => {
    expect(sanitizeCsvCell(value)).toBe(`'${value}`);
  });

  it('erkennt Formeln auch hinter führendem Whitespace', () => {
    // Manche Programme verwerfen führende Steuerzeichen und werten den
    // Rest danach doch als Formel aus.
    expect(sanitizeCsvCell('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeCsvCell(' =1+1')).toBe("' =1+1");
  });

  it('lässt harmlose Werte unverändert', () => {
    expect(sanitizeCsvCell('Anna Müller')).toBe('Anna Müller');
    expect(sanitizeCsvCell('a=b')).toBe('a=b'); // nur der Zellenanfang zählt
    expect(sanitizeCsvCell('2026-09-02')).toBe('2026-09-02');
  });

  it('macht aus null/undefined einen leeren String', () => {
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(undefined)).toBe('');
  });

  it('entschärft alle Werte einer Zeile', () => {
    expect(sanitizeCsvRow({ name: '=BÖSE()', ort: 'Bern' })).toEqual({
      name: "'=BÖSE()",
      ort: 'Bern',
    });
  });
});
