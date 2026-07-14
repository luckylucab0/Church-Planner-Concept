import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { hashToken } from '../common/crypto/tokens';
import { PrismaService } from '../prisma/prisma.service';

// Einmal-Backup-Codes für 2FA. Format XXXX-XXXX aus einem Alphabet ohne
// verwechselbare Zeichen (0/O, 1/l/i) und BEWUSST mit Buchstaben – so ist
// ein Backup-Code nie mit einem 6-stelligen TOTP-Code zu verwechseln und
// der Login kann die beiden Pfade eindeutig unterscheiden.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_COUNT = 10;

@Injectable()
export class BackupCodesService {
  constructor(private readonly prisma: PrismaService) {}

  private randomCode(): string {
    const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
  }

  // Kleinschreibung + Bindestrich normalisieren, damit Tippvarianten
  // (Großbuchstaben, fehlender Strich) trotzdem passen.
  private normalize(code: string): string {
    const stripped = code.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
  }

  // Alte Codes ersetzen und 10 neue erzeugen. Rückgabe ist der Klartext –
  // gespeichert werden nur die Hashes; nach dieser Antwort sind die Codes
  // nirgendwo mehr rekonstruierbar.
  async regenerate(accountId: string): Promise<string[]> {
    const codes = Array.from({ length: CODE_COUNT }, () => this.randomCode());
    await this.prisma.$transaction([
      this.prisma.totpBackupCode.deleteMany({ where: { accountId } }),
      this.prisma.totpBackupCode.createMany({
        data: codes.map((code) => ({ accountId, codeHash: hashToken(code) })),
      }),
    ]);
    return codes;
  }

  // Single-use: updateMany mit usedAt=null ist atomar – zwei parallele
  // Logins mit demselben Code können ihn nicht doppelt einlösen.
  async consume(accountId: string, code: string): Promise<boolean> {
    const result = await this.prisma.totpBackupCode.updateMany({
      where: { accountId, codeHash: hashToken(this.normalize(code)), usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }

  async countRemaining(accountId: string): Promise<number> {
    return this.prisma.totpBackupCode.count({ where: { accountId, usedAt: null } });
  }

  async deleteAll(accountId: string): Promise<void> {
    await this.prisma.totpBackupCode.deleteMany({ where: { accountId } });
  }
}
