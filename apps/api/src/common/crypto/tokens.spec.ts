import { generateToken, hashToken, tokenHashEquals } from './tokens';

describe('tokens', () => {
  it('erzeugt URL-sichere Tokens mit ausreichender Länge (128 Bit)', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url ohne Padding
    expect(token.length).toBeGreaterThanOrEqual(22);
  });

  it('erzeugt bei jedem Aufruf ein anderes Token', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('hasht deterministisch (DB-Lookup über Hash muss funktionieren)', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toHaveLength(64); // sha256 hex
  });

  it('vergleicht Hashes konstantzeit-sicher', () => {
    const hash = hashToken(generateToken());
    expect(tokenHashEquals(hash, hash)).toBe(true);
    expect(tokenHashEquals(hash, hashToken(generateToken()))).toBe(false);
  });
});
