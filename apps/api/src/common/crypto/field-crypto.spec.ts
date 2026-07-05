import { decryptField, encryptField } from './field-crypto';

describe('field-crypto (AES-256-GCM)', () => {
  it('verschlüsselt und entschlüsselt roundtrip inkl. Umlauten', () => {
    const plaintext = 'Seelsorgerliche Notiz: Gespräch über Ängste, vertraulich! äöü';
    expect(decryptField(encryptField(plaintext))).toBe(plaintext);
  });

  it('erzeugt für gleichen Klartext unterschiedliche Ciphertexte (zufälliger IV)', () => {
    const a = encryptField('gleicher Text');
    const b = encryptField('gleicher Text');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('wirft bei manipuliertem Ciphertext (GCM-Authentifizierung)', () => {
    const encrypted = encryptField('Original');
    encrypted[encrypted.length - 20] ^= 0xff; // ein Byte im Ciphertext kippen
    expect(() => decryptField(encrypted)).toThrow();
  });

  it('wirft bei unbekannter Key-Version statt falsch zu entschlüsseln', () => {
    const encrypted = encryptField('Original');
    encrypted[0] = 99;
    expect(() => decryptField(encrypted)).toThrow(/Key-Version/);
  });
});
