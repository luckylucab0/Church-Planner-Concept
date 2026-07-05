import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthUser } from './auth.types';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { AuditService } from '../audit/audit.service';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { env } from '../common/config/env';
import { MailerService } from '../notifications/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

export interface LoginResult {
  sessionToken: string;
  user: AuthUser;
}

// Fehlversuche bis zur ersten Sperre; danach exponentieller Backoff.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MAX_SECONDS = 900;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  // Alle Fehlerfälle liefern dieselbe generische Meldung – ein Angreifer
  // erfährt nicht, ob die E-Mail existiert, das Passwort falsch ist oder
  // das Konto gesperrt wurde (User Enumeration).
  async login(
    email: string,
    password: string,
    totpCode: string | undefined,
    ip: string,
  ): Promise<LoginResult> {
    const fail = (): never => {
      this.audit.log({ action: 'LOGIN_FAILED', entityType: 'UserAccount', ip });
      throw new UnauthorizedException({ message: 'auth.invalidCredentials' });
    };

    const person = await this.prisma.person.findUnique({
      where: { email },
      include: { account: true },
    });
    const account = person?.account;
    if (!person || !account) {
      // Dummy-Hash verifizieren, damit die Antwortzeit nicht verrät,
      // ob das Konto existiert (Timing-Seitenkanal)
      await argon2
        .verify(
          '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          password,
        )
        .catch(() => false);
      return fail();
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      return fail();
    }

    const passwordOk = await argon2.verify(account.passwordHash, password).catch(() => false);
    if (!passwordOk) {
      // Exponentieller Backoff: 2^(n - Schwelle) Sekunden, gedeckelt –
      // bremst Brute Force zusätzlich zum Rate Limiting
      const failedCount = account.failedLoginCount + 1;
      const lockSeconds =
        failedCount >= LOCKOUT_THRESHOLD
          ? Math.min(2 ** (failedCount - LOCKOUT_THRESHOLD + 1), LOCKOUT_MAX_SECONDS)
          : 0;
      await this.prisma.userAccount.update({
        where: { id: account.id },
        data: {
          failedLoginCount: failedCount,
          lockedUntil: lockSeconds > 0 ? new Date(Date.now() + lockSeconds * 1000) : null,
        },
      });
      return fail();
    }

    if (account.totpEnabled) {
      if (!totpCode) {
        // Eigener Fehlercode: das Frontend zeigt daraufhin das 2FA-Feld.
        // Kein Audit-"LOGIN_FAILED" – das Passwort war korrekt.
        throw new UnauthorizedException({ message: 'auth.totpRequired', code: 'TOTP_REQUIRED' });
      }
      if (
        !account.totpSecretEncrypted ||
        !this.totp.verify(totpCode, account.totpSecretEncrypted)
      ) {
        return fail();
      }
    }

    await this.prisma.userAccount.update({
      where: { id: account.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const user: AuthUser = {
      accountId: account.id,
      personId: person.id,
      globalRole: account.globalRole,
    };
    const sessionToken = await this.sessions.create(user);
    this.audit.log({
      actorId: person.id,
      action: 'LOGIN',
      entityType: 'UserAccount',
      entityId: account.id,
      ip,
    });
    return { sessionToken, user };
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessions.destroy(sessionToken);
  }

  // --- 2FA -------------------------------------------------

  async setupTotp(user: AuthUser): Promise<{ otpauthUrl: string; secret: string }> {
    const person = await this.prisma.person.findUniqueOrThrow({ where: { id: user.personId } });
    const { secret, encrypted } = this.totp.generateSecret();
    // Secret speichern, aber erst nach erfolgreichem verify() aktivieren –
    // sonst sperrt sich aus, wer die App nicht fertig eingerichtet hat
    await this.prisma.userAccount.update({
      where: { id: user.accountId },
      data: { totpSecretEncrypted: encrypted, totpEnabled: false },
    });
    return { otpauthUrl: this.totp.buildOtpauthUrl(secret, person.email ?? 'serveflow'), secret };
  }

  async verifyTotp(user: AuthUser, code: string): Promise<void> {
    const account = await this.prisma.userAccount.findUniqueOrThrow({
      where: { id: user.accountId },
    });
    if (!account.totpSecretEncrypted || !this.totp.verify(code, account.totpSecretEncrypted)) {
      throw new UnauthorizedException({ message: 'auth.invalidTotp' });
    }
    await this.prisma.userAccount.update({
      where: { id: user.accountId },
      data: { totpEnabled: true },
    });
  }

  // --- Passwort-Reset --------------------------------------

  // Antwortet immer gleich (204), egal ob die E-Mail existiert –
  // sonst wäre der Endpoint ein User-Enumeration-Orakel.
  async requestPasswordReset(email: string): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { email },
      include: { account: true },
    });
    if (!person?.account) return;

    const token = generateToken();
    await this.prisma.authToken.create({
      data: {
        personId: person.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 h
      },
    });
    await this.mailer.send({
      to: email,
      subject: 'ServeFlow: Passwort zurücksetzen',
      text:
        `Hallo ${person.firstName},\n\n` +
        `über diesen Link kannst du innerhalb von 1 Stunde ein neues Passwort setzen:\n` +
        `${env.APP_URL}/reset-password?token=${token}\n\n` +
        `Falls du das nicht angefordert hast, ignoriere diese Mail.`,
    });
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { person: { include: { account: true } } },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.person.account) {
      throw new UnauthorizedException({ message: 'auth.invalidResetToken' });
    }
    const accountId = record.person.account.id;
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.userAccount.update({
        where: { id: accountId },
        data: {
          passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
    ]);
    // Nach Passwort-Reset alle bestehenden Sessions beenden – Standard-
    // Reaktion auf ein möglicherweise kompromittiertes Konto
    await this.sessions.destroyAllForAccount(accountId);
    this.audit.log({
      actorId: record.personId,
      action: 'UPDATE',
      entityType: 'UserAccount',
      entityId: accountId,
      changedFields: ['passwordHash'],
    });
  }
}
