// Token-Erzeugung für Zusage/Absage-Links, iCal-Feeds, Passwort-Reset
// und Sessions.
//
// Sicherheitsmodell: Das Token selbst (128 Bit Zufall) steht NUR in der
// URL bzw. im Cookie des Empfängers. In der Datenbank liegt ausschließlich
// der SHA-256-Hash – ein DB-Leak verrät damit keine gültigen Links.
// SHA-256 (statt argon2) reicht hier, weil die Eingabe kein schwaches
// Passwort ist, sondern 128 Bit echter Zufall – Brute-Force ist aussichtslos.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(): string {
  // base64url: URL-sicher ohne Encoding-Sonderfälle in Mail-Clients
  return randomBytes(16).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Konstantzeit-Vergleich zweier Hashes – verhindert Timing-Seitenkanäle,
// falls ein Code-Pfad doch einmal Hash mit Hash vergleicht statt per
// DB-Lookup zu suchen.
export function tokenHashEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
