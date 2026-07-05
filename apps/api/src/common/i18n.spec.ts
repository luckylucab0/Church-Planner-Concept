import { interpolate, messages } from '@serveflow/shared';

describe('shared i18n', () => {
  it('interpoliert Platzhalter als Plain Text', () => {
    expect(interpolate('Hallo {{name}}, Termin am {{date}}', { name: 'Anna', date: '5.7.' })).toBe(
      'Hallo Anna, Termin am 5.7.',
    );
  });

  it('lässt unbekannte Platzhalter sichtbar stehen statt sie zu verschlucken', () => {
    // Ein stiller Fallback würde kaputte Mails unbemerkt lassen
    expect(interpolate('Hallo {{name}}', {})).toBe('Hallo {{name}}');
  });

  it('hat beide Sprachen registriert', () => {
    expect(Object.keys(messages).sort()).toEqual(['de', 'en']);
  });
});
