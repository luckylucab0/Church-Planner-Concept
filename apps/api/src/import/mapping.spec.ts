import { parseBirthday, suggestMapping } from './mapping';

describe('suggestMapping (Spaltenerkennung)', () => {
  it('erkennt typische Elvanto-Header', () => {
    const mapping = suggestMapping(
      ['First Name', 'Last Name', 'Email', 'Mobile', 'Date of Birth', 'Home Address', 'Groups'],
      'ELVANTO_CSV',
    );
    expect(mapping['First Name']).toBe('firstName');
    expect(mapping['Last Name']).toBe('lastName');
    expect(mapping['Email']).toBe('email');
    expect(mapping['Mobile']).toBe('phone');
    expect(mapping['Date of Birth']).toBe('birthday');
    expect(mapping['Home Address']).toBe('address');
    expect(mapping['Groups']).toBe('teams');
  });

  it('erkennt typische Planning-Center-Header', () => {
    const mapping = suggestMapping(
      ['first_name', 'last_name', 'Home Email', 'Mobile Phone Number', 'Birthdate'],
      'PCO_CSV',
    );
    expect(mapping['first_name']).toBe('firstName');
    expect(mapping['last_name']).toBe('lastName');
    expect(mapping['Home Email']).toBe('email');
    expect(mapping['Mobile Phone Number']).toBe('phone');
    expect(mapping['Birthdate']).toBe('birthday');
  });

  it('mappt Unbekanntes auf notes statt es zu verwerfen', () => {
    const mapping = suggestMapping(['Lieblingsfarbe'], 'ELVANTO_CSV');
    expect(mapping['Lieblingsfarbe']).toBe('notes');
  });

  it('schlägt für interne IDs ignore vor', () => {
    const mapping = suggestMapping(['ID', 'Created At'], 'PCO_CSV');
    expect(mapping['ID']).toBe('ignore');
    expect(mapping['Created At']).toBe('ignore');
  });

  it('vergibt Personen-Felder nur einmal (Home Email gewinnt vor Work Email)', () => {
    const mapping = suggestMapping(['Home Email', 'Work Email'], 'PCO_CSV');
    expect(mapping['Home Email']).toBe('email');
    expect(mapping['Work Email']).toBe('notes');
  });
});

describe('parseBirthday', () => {
  it('parst ISO- und dd.mm.yyyy-Daten', () => {
    expect(parseBirthday('1990-05-01')?.getFullYear()).toBe(1990);
    expect(parseBirthday('01.05.1990')?.getMonth()).toBe(4);
    expect(parseBirthday('1/5/1990')?.getDate()).toBe(1);
  });

  it('liefert undefined für Müll', () => {
    expect(parseBirthday('')).toBeUndefined();
    expect(parseBirthday('kein datum')).toBeUndefined();
  });
});
