// Applikationsseitige Verschlüsselung sensibler Felder (Notizen,
// TOTP-Secrets) mit AES-256-GCM. Schützt gegen DB-Dump-Leaks und direkte
// DB-Zugriffe – Begründung und Trade-offs in docs/security.md.
//
// Speicherformat: [ 1 Byte Key-Version | 12 Byte IV | Ciphertext | 16 Byte Auth-Tag ]
// Die Key-Version erlaubt spätere Rotation: neue Schreibvorgänge nutzen den
// neuen Key, alte Werte bleiben mit dem alten Key lesbar, bis sie neu
// gespeichert werden.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const KEY_VERSION = 1;
const IV_LENGTH = 12; // GCM-Standard
const TAG_LENGTH = 16;

function keyFor(version: number): Buffer {
  if (version !== KEY_VERSION) {
    throw new Error(`Unbekannte Key-Version ${version} – Key-Rotation unvollständig?`);
  }
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY muss 32 Bytes base64-codiert sein (openssl rand -base64 32)',
    );
  }
  return key;
}

// Rückgabe als Uint8Array: exakt der Typ, den Prisma für Bytes-Felder
// erwartet (Buffer<ArrayBufferLike> ist dazu nicht zuweisbar).
export function encryptField(plaintext: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyFor(KEY_VERSION), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // Uint8Array.from statt new Uint8Array: liefert garantiert einen
  // frischen ArrayBuffer (nicht ArrayBufferLike) – Prismas Bytes-Typ
  return Uint8Array.from(
    Buffer.concat([Buffer.from([KEY_VERSION]), iv, ciphertext, cipher.getAuthTag()]),
  );
}

export function decryptField(stored: Buffer | Uint8Array): string {
  const data = Buffer.from(stored);
  if (data.length < 1 + IV_LENGTH + TAG_LENGTH) {
    throw new Error('Verschlüsseltes Feld ist zu kurz – Daten korrupt?');
  }
  const version = data.readUInt8(0);
  const iv = data.subarray(1, 1 + IV_LENGTH);
  const authTag = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(1 + IV_LENGTH, data.length - TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', keyFor(version), iv);
  decipher.setAuthTag(authTag);
  // GCM authentifiziert: manipulierte Ciphertexte werfen hier statt
  // stillschweigend Müll zurückzugeben
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
