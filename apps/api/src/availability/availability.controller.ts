import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { RRule } from 'rrule';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

export class CreateAbsenceDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  fromDate: string;

  @ApiProperty({ example: '2026-08-15' })
  @IsDateString()
  toDate: string;

  @ApiPropertyOptional({ description: 'Optional – nur für dich und Admins sichtbar' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateRecurringDto {
  @ApiProperty({
    example: 'FREQ=MONTHLY;BYDAY=1SU',
    description: 'RRULE, z. B. jeden 1. Sonntag im Monat',
  })
  @IsString()
  @MaxLength(200)
  rrule: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

// Selbstverwaltung der eigenen Verfügbarkeit. Bewusst nur unter /me –
// niemand pflegt die Abwesenheit anderer (Admins sehen sie im
// Konfliktfall über die Vorschlags-Engine bzw. den 409 beim Einteilen).
@ApiTags('availability')
@Controller('me')
export class AvailabilityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('absences')
  @ApiOperation({ summary: 'Eigene Abwesenheiten (Ferien, Blockzeiten)' })
  listAbsences(@CurrentUser() user: AuthUser) {
    return this.prisma.absence.findMany({
      where: { personId: user.personId },
      orderBy: { fromDate: 'asc' },
    });
  }

  @Post('absences')
  @ApiOperation({ summary: 'Abwesenheit eintragen' })
  createAbsence(@CurrentUser() user: AuthUser, @Body() dto: CreateAbsenceDto) {
    const fromDate = new Date(dto.fromDate);
    const toDate = new Date(dto.toDate);
    if (toDate < fromDate) {
      throw new BadRequestException('Enddatum liegt vor dem Startdatum');
    }
    return this.prisma.absence.create({
      data: { personId: user.personId, fromDate, toDate, reason: dto.reason },
    });
  }

  @Delete('absences/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Abwesenheit löschen' })
  async deleteAbsence(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    // deleteMany mit personId-Filter: löscht garantiert nur eigene Einträge
    await this.prisma.absence.deleteMany({ where: { id, personId: user.personId } });
  }

  @Get('recurring-unavailabilities')
  @ApiOperation({ summary: 'Wiederkehrende Nichtverfügbarkeit (z. B. jeden 1. Sonntag)' })
  listRecurring(@CurrentUser() user: AuthUser) {
    return this.prisma.recurringUnavailability.findMany({
      where: { personId: user.personId },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('recurring-unavailabilities')
  @ApiOperation({ summary: 'Wiederkehrende Nichtverfügbarkeit anlegen (RRULE)' })
  createRecurring(@CurrentUser() user: AuthUser, @Body() dto: CreateRecurringDto) {
    try {
      RRule.fromString(dto.rrule);
    } catch {
      throw new BadRequestException('Ungültige RRULE, z. B. FREQ=MONTHLY;BYDAY=1SU');
    }
    return this.prisma.recurringUnavailability.create({
      data: { personId: user.personId, rrule: dto.rrule, note: dto.note },
    });
  }

  @Delete('recurring-unavailabilities/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Wiederkehrende Nichtverfügbarkeit löschen' })
  async deleteRecurring(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.prisma.recurringUnavailability.deleteMany({
      where: { id, personId: user.personId },
    });
  }
}
