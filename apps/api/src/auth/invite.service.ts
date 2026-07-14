import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { interpolate, Locale, messages } from '@serveflow/shared';
import { AuthUser } from './auth.types';
import { AuditService } from '../audit/audit.service';
import { env } from '../common/config/env';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { MailerService } from '../notifications/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

// Großzügiger als beim Passwort-Reset: die eingeladene Person kennt das
// Tool noch nicht und liest ihre Mails vielleicht erst nach Tagen.
const INVITE_TTL_DAYS = 7;

// Einladung: Admin (oder ein genehmigter Benutzer-Antrag) lädt eine
// Person ohne Konto per Mail ein; der Link führt zum Passwort-Setzen und
// erzeugt erst dann das UserAccount. Personen ohne Konto bleiben voll
// planbar – das Konto ist nur der Login.
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  private mailTexts(locale: string | null | undefined) {
    return messages[(locale === 'en' ? 'en' : 'de') as Locale].mail;
  }

  async sendInvite(actor: AuthUser, personId: string): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: { account: true },
    });
    if (!person) throw new NotFoundException();
    if (person.account) throw new BadRequestException('Person hat bereits ein Konto');
    if (!person.email) throw new BadRequestException('Person hat keine E-Mail-Adresse');

    // Erneut einladen invalidiert alte Links: es gibt immer genau einen
    // gültigen Einladungslink pro Person.
    await this.prisma.authToken.updateMany({
      where: { personId, purpose: 'INVITE', usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateToken();
    await this.prisma.authToken.create({
      data: {
        personId,
        purpose: 'INVITE',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    const texts = this.mailTexts(person.locale);
    const vars = {
      firstName: person.firstName,
      email: person.email,
      inviteUrl: `${env.APP_URL}/invite?token=${token}`,
      days: String(INVITE_TTL_DAYS),
    };
    await this.mailer.send({
      to: person.email,
      subject: interpolate(texts.inviteSubject, vars),
      text: interpolate(texts.inviteBody, vars),
    });
    await this.prisma.notificationLog.create({
      data: { personId, kind: 'INVITE' },
    });
    this.audit.log({
      actorId: actor.personId,
      action: 'CREATE',
      entityType: 'AuthToken',
      entityId: personId,
      changedFields: ['invite'],
    });
  }

  async confirmInvite(token: string, password: string): Promise<void> {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { person: { include: { account: true } } },
    });
    // Ein Fehler, eine Antwort: kein Orakel, ob der Token existiert,
    // abgelaufen ist oder das Konto inzwischen existiert.
    if (
      !record ||
      record.purpose !== 'INVITE' ||
      record.usedAt ||
      record.expiresAt < new Date() ||
      record.person.account
    ) {
      throw new UnauthorizedException({ message: 'auth.invalidInviteToken' });
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const [, account] = await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.userAccount.create({
        data: { personId: record.personId, passwordHash, globalRole: 'MEMBER' },
      }),
    ]);
    this.audit.log({
      actorId: record.personId,
      action: 'CREATE',
      entityType: 'UserAccount',
      entityId: account.id,
    });
  }
}
