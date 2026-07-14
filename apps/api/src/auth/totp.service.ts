import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import { decryptField, encryptField } from '../common/crypto/field-crypto';

// TOTP-2FA (RFC 6238) für Admin- und Teamleiter-Konten (für alle optional).
// Das Secret liegt AES-verschlüsselt in der DB – ein DB-Leak allein
// reicht nicht, um 2FA-Codes zu erzeugen.
@Injectable()
export class TotpService {
  generateSecret(): { secret: string; encrypted: Uint8Array<ArrayBuffer> } {
    const secret = authenticator.generateSecret();
    return { secret, encrypted: encryptField(secret) };
  }

  buildOtpauthUrl(secret: string, accountEmail: string): string {
    return authenticator.keyuri(accountEmail, 'ServeFlow', secret);
  }

  // QR-Code serverseitig als Data-URL: das Secret läuft nie durch eine
  // Drittanbieter-Komponente, und die CSP (img-src 'self' data:) bleibt eng.
  buildQrDataUrl(otpauthUrl: string): Promise<string> {
    return toDataURL(otpauthUrl, { margin: 1, width: 220 });
  }

  verify(code: string, encryptedSecret: Buffer | Uint8Array): boolean {
    const secret = decryptField(encryptedSecret);
    // otplib toleriert standardmäßig ±1 Zeitfenster (30 s) – guter
    // Kompromiss zwischen Usability (Uhr-Drift) und Sicherheit
    return authenticator.verify({ token: code, secret });
  }
}
