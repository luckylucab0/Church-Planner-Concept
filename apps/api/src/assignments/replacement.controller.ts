import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsUUID } from 'class-validator';
import { ReplacementService } from './replacement.service';
import { SignupService } from './signup.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';

export class RequestReplacementDto {
  @ApiProperty({ description: 'Person, die den Dienst übernehmen soll' })
  @IsUUID()
  candidatePersonId: string;
}

export class SetSignupOpenDto {
  @ApiProperty({ description: 'Slot zur Selbst-Eintragung freigeben' })
  @IsBoolean()
  open: boolean;
}

// Vertretung aus Sicht der eingeteilten Person ("Meine Dienste")
@ApiTags('me')
@Controller('me/assignments')
export class MyReplacementController {
  constructor(private readonly replacements: ReplacementService) {}

  @Get(':id/replacement-candidates')
  @ApiOperation({ summary: 'Mögliche Vertretungen für die eigene Einteilung' })
  candidates(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.replacements.candidates(user, id);
  }

  @Post(':id/replacement-request')
  @ApiOperation({ summary: 'Vertretung anfragen (Mail mit Übernahme-Link an die Person)' })
  request(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestReplacementDto,
  ) {
    return this.replacements.request(user, id, dto.candidatePersonId);
  }

  @Delete(':id/replacement-request')
  @HttpCode(204)
  @ApiOperation({ summary: 'Offene Vertretungsanfrage zurückziehen' })
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.replacements.cancel(user, id);
  }
}

// Tokenbasierte Übernahme – ohne Login nutzbar (Link aus der Mail),
// eng rate-limitiert wie der Respond-Flow.
@ApiTags('respond')
@Controller('replacement')
export class ReplacementTokenController {
  constructor(private readonly replacements: ReplacementService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: 'Infos zur Vertretungsanfrage (nur Vornamen + Termin)' })
  info(@Param('token') token: string) {
    return this.replacements.tokenInfo(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dienst übernehmen (Einteilung wandert auf die Vertretung)' })
  accept(@Param('token') token: string) {
    return this.replacements.respondByToken(token, true);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Übernahme ablehnen (anfragende Person wird informiert)' })
  decline(@Param('token') token: string) {
    return this.replacements.respondByToken(token, false);
  }
}

// Selbst-Eintragung (Signup Sheets)
@ApiTags('signup')
@Controller('signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Get('open')
  @ApiOperation({ summary: 'Offene Dienste, in die ich mich eintragen kann' })
  open(@CurrentUser() user: AuthUser) {
    return this.signup.openForMe(user);
  }

  @Post('slots/:slotId')
  @ApiOperation({ summary: 'Selbst eintragen (zählt direkt als Zusage)' })
  join(@CurrentUser() user: AuthUser, @Param('slotId', ParseUUIDPipe) slotId: string) {
    return this.signup.signup(user, slotId);
  }

  @Patch('slots/:slotId')
  @ApiOperation({ summary: 'Slot zur Selbst-Eintragung freigeben/schließen (Admin/Teamleiter)' })
  setOpen(
    @CurrentUser() user: AuthUser,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: SetSignupOpenDto,
  ) {
    return this.signup.setOpen(user, slotId, dto.open);
  }
}
