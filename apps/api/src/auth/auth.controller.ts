import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, AuthUser } from './auth.types';
import { CurrentUser, Public } from './decorators';
import { SESSION_COOKIE } from './guards/session-auth.guard';
import {
  ChangePasswordDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  TotpDisableDto,
  TotpVerifyDto,
} from './dto/auth.dto';
import { env } from '../common/config/env';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, // kein JS-Zugriff → XSS kann das Cookie nicht stehlen
      secure: env.NODE_ENV === 'production', // in Produktion nur über TLS
      sameSite: 'lax', // CSRF-Grundschutz, ergänzt durch OriginCheckGuard
      path: '/',
      maxAge: env.SESSION_TTL_HOURS * 3600,
    });
  }

  // Enges Rate Limit zusätzlich zum Konto-Lockout: bremst auch verteiltes
  // Raten über viele Konten hinweg
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login mit E-Mail/Passwort (+ TOTP falls aktiviert)' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { sessionToken, user } = await this.auth.login(
      dto.email,
      dto.password,
      dto.totpCode,
      request.ip,
    );
    this.setSessionCookie(reply, sessionToken);
    return this.buildSessionInfo(user);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Session beenden' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (request.sessionToken) {
      await this.auth.logout(request.sessionToken);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('session')
  @ApiOperation({ summary: 'Aktuelle Session (wer bin ich, welche Rolle)' })
  async session(@CurrentUser() user: AuthUser) {
    return this.buildSessionInfo(user);
  }

  // --- Passwort ändern (eingeloggt) -------------------------

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eigenes Passwort ändern (aktuelles Passwort als Nachweis)' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(
      user,
      request.sessionToken ?? '',
      dto.currentPassword,
      dto.newPassword,
    );
  }

  // --- 2FA -------------------------------------------------

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/setup')
  @ApiOperation({ summary: 'TOTP-Secret + QR + Backup-Codes erzeugen (aktiv erst nach verify)' })
  async totpSetup(@CurrentUser() user: AuthUser) {
    return this.auth.setupTotp(user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/verify')
  @HttpCode(204)
  @ApiOperation({ summary: 'TOTP-Code prüfen und 2FA aktivieren' })
  async totpVerify(@CurrentUser() user: AuthUser, @Body() dto: TotpVerifyDto): Promise<void> {
    await this.auth.verifyTotp(user, dto.code);
  }

  @Get('2fa/status')
  @ApiOperation({ summary: '2FA-Status (aktiv? verbleibende Backup-Codes)' })
  async totpStatus(@CurrentUser() user: AuthUser) {
    return this.auth.getTotpStatus(user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/backup-codes')
  @ApiOperation({ summary: 'Neue Backup-Codes erzeugen (TOTP-Code als Nachweis)' })
  async totpBackupCodes(@CurrentUser() user: AuthUser, @Body() dto: TotpVerifyDto) {
    return this.auth.regenerateBackupCodes(user, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/disable')
  @HttpCode(204)
  @ApiOperation({ summary: '2FA deaktivieren (Passwort als Nachweis)' })
  async totpDisable(@CurrentUser() user: AuthUser, @Body() dto: TotpDisableDto): Promise<void> {
    await this.auth.disableTotp(user, dto.password);
  }

  // --- Passwort-Reset --------------------------------------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reset-Mail anfordern (antwortet immer 204)' })
  async passwordReset(@Body() dto: PasswordResetRequestDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Neues Passwort mit Reset-Token setzen' })
  async passwordResetConfirm(@Body() dto: PasswordResetConfirmDto): Promise<void> {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
  }

  // Session-Info inkl. Anzeigename – erspart dem Frontend einen zweiten
  // Request nach dem Login
  private async buildSessionInfo(user: AuthUser) {
    const person = await this.prisma.person.findUniqueOrThrow({
      where: { id: user.personId },
      select: { firstName: true, lastName: true, locale: true },
    });
    const leaderships = await this.prisma.teamMembership.findMany({
      where: { personId: user.personId, role: 'LEADER' },
      select: { teamId: true },
    });
    return {
      personId: user.personId,
      globalRole: user.globalRole,
      firstName: person.firstName,
      lastName: person.lastName,
      locale: person.locale,
      ledTeamIds: leaderships.map((l) => l.teamId),
    };
  }
}
