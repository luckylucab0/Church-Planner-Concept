import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { interpolate, Locale, messages } from '@serveflow/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { env } from '../common/config/env';
import { MailerService } from '../notifications/mailer.service';
import { PermissionsService } from '../authz/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

// Selbst-Eintragung (Signup Sheets): Teamleiter geben einzelne Slots
// frei, Mitglieder mit passender Position tragen sich selbst ein –
// typisch für Dienste wie Kaffee oder Aufbau. Die Eintragung zählt
// direkt als Zusage; die Teamleitung wird informiert.
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly availability: AvailabilityService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  private async loadSlot(slotId: string) {
    const slot = await this.prisma.eventPositionSlot.findUnique({
      where: { id: slotId },
      include: {
        event: true,
        position: { include: { team: { select: { id: true, name: true, color: true } } } },
        assignments: { select: { personId: true, status: true } },
      },
    });
    if (!slot) throw new NotFoundException('Slot nicht gefunden');
    return slot;
  }

  // Slot für Selbst-Eintragung öffnen/schließen (Admin oder Teamleiter)
  async setOpen(user: AuthUser, slotId: string, open: boolean) {
    const slot = await this.loadSlot(slotId);
    if (!this.permissions.isAdmin(user)) {
      const ledTeams = await this.permissions.getLedTeamIds(user.personId);
      if (!ledTeams.includes(slot.position.team.id)) {
        throw new ForbiddenException('Nur Admins oder Leiter dieses Teams');
      }
    }
    const updated = await this.prisma.eventPositionSlot.update({
      where: { id: slotId },
      data: { openForSignup: open },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'EventPositionSlot',
      entityId: slotId,
      changedFields: ['openForSignup'],
    });
    return { id: updated.id, openForSignup: updated.openForSignup };
  }

  // Offene Dienste, für die ICH mich eintragen kann: freigegebene Slots
  // künftiger veröffentlichter Termine, passende Position, noch Platz,
  // nicht schon am selben Termin eingeteilt, nicht abwesend.
  async openForMe(user: AuthUser) {
    const skills = await this.prisma.positionSkill.findMany({
      where: { personId: user.personId },
      select: { positionId: true },
    });
    if (skills.length === 0) return [];

    const slots = await this.prisma.eventPositionSlot.findMany({
      where: {
        openForSignup: true,
        positionId: { in: skills.map((s) => s.positionId) },
        event: { status: 'PUBLISHED', startsAt: { gte: new Date() } },
      },
      include: {
        event: true,
        position: { include: { team: { select: { name: true, color: true } } } },
        assignments: { select: { personId: true, status: true } },
      },
      orderBy: { event: { startsAt: 'asc' } },
    });

    // Bereits belegte Termine des Nutzers (egal welcher Slot des Events)
    const myAssignments = await this.prisma.assignment.findMany({
      where: {
        personId: user.personId,
        status: { not: 'DECLINED' },
        slot: { eventId: { in: slots.map((s) => s.eventId) } },
      },
      select: { slot: { select: { eventId: true } } },
    });
    const myEventIds = new Set(myAssignments.map((a) => a.slot.eventId));

    const result = [];
    for (const slot of slots) {
      const taken = slot.assignments.filter((a) => a.status !== 'DECLINED').length;
      if (taken >= slot.requiredCount) continue;
      if (myEventIds.has(slot.eventId)) continue;
      if (await this.availability.isUnavailable(user.personId, slot.event.startsAt)) continue;
      result.push({
        slotId: slot.id,
        eventId: slot.eventId,
        eventTitle: slot.event.title,
        startsAt: slot.event.startsAt,
        location: slot.event.location,
        team: slot.position.team,
        position: slot.position.name,
        openCount: slot.requiredCount - taken,
      });
    }
    return result;
  }

  async signup(user: AuthUser, slotId: string) {
    const slot = await this.loadSlot(slotId);
    if (slot.event.status !== 'PUBLISHED') {
      throw new ForbiddenException('Dieser Dienst ist nicht zur Selbst-Eintragung freigegeben');
    }
    // Admins/Teamleiter des Slot-Teams dürfen sich auch ohne Freigabe
    // eintragen – sie könnten den Slot ohnehin selbst freigeben.
    if (!slot.openForSignup) {
      const mayBypass =
        this.permissions.isAdmin(user) ||
        (await this.permissions.getLedTeamIds(user.personId)).includes(slot.position.team.id);
      if (!mayBypass) {
        throw new ForbiddenException('Dieser Dienst ist nicht zur Selbst-Eintragung freigegeben');
      }
    }
    if (slot.event.startsAt < new Date()) {
      throw new ForbiddenException('Termin liegt in der Vergangenheit');
    }
    const skill = await this.prisma.positionSkill.findUnique({
      where: { positionId_personId: { positionId: slot.positionId, personId: user.personId } },
    });
    if (!skill) {
      throw new ForbiddenException('Du bist dieser Position nicht zugeordnet');
    }
    const taken = slot.assignments.filter((a) => a.status !== 'DECLINED').length;
    if (taken >= slot.requiredCount) {
      throw new ConflictException('Dieser Dienst ist bereits voll besetzt');
    }
    if (await this.availability.isUnavailable(user.personId, slot.event.startsAt)) {
      throw new ConflictException({
        message: 'Du bist an diesem Termin als abwesend eingetragen',
        code: 'UNAVAILABLE',
      });
    }
    const sameEvent = await this.prisma.assignment.findFirst({
      where: {
        personId: user.personId,
        status: { not: 'DECLINED' },
        slot: { eventId: slot.eventId },
      },
    });
    if (sameEvent) {
      throw new ConflictException('Du bist an diesem Termin bereits eingeteilt');
    }

    let assignment;
    try {
      assignment = await this.prisma.assignment.create({
        data: {
          slotId,
          personId: user.personId,
          // Selbst-Eintragung = direkte Zusage, kein Anfrage-Pingpong
          status: 'ACCEPTED',
          assignedById: user.personId,
          respondedAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Du bist in diesem Slot bereits eingeteilt');
      }
      throw error;
    }
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Assignment',
      entityId: assignment.id,
    });
    await this.notifyLeaders(assignment.id);
    return assignment;
  }

  private async notifyLeaders(assignmentId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        person: { select: { firstName: true, lastName: true } },
        slot: { include: { event: true, position: { include: { team: true } } } },
      },
    });
    const leaders = await this.prisma.teamMembership.findMany({
      where: { teamId: assignment.slot.position.teamId, isLeader: true },
      include: { person: true },
    });
    for (const leader of leaders) {
      if (!leader.person.email) continue;
      const texts = messages[(leader.person.locale === 'en' ? 'en' : 'de') as Locale].mail;
      const vars = {
        leaderName: leader.person.firstName,
        personName: `${assignment.person.firstName} ${assignment.person.lastName}`,
        position: assignment.slot.position.name,
        eventTitle: assignment.slot.event.title,
        date: assignment.slot.event.startsAt.toLocaleString(
          leader.person.locale === 'en' ? 'en-GB' : 'de-CH',
          {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          },
        ),
        planUrl: `${env.APP_URL}/plans/${assignment.slot.eventId}`,
      };
      await this.mailer.send({
        to: leader.person.email,
        subject: interpolate(texts.signupAlertSubject, vars),
        text: interpolate(texts.signupAlertBody, vars),
      });
      await this.prisma.notificationLog.create({
        data: { personId: leader.personId, assignmentId, kind: 'SIGNUP_ALERT' },
      });
    }
  }
}
