import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma } from '@prisma/client';
import { interpolate, Locale, messages } from '@serveflow/shared';
import { CandidateFacts, scoreCandidates, Suggestion } from './suggestion-engine';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { PermissionsService } from '../authz/permissions.service';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { env } from '../common/config/env';
import { MailerService } from '../notifications/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

// Respond-Tokens laufen spätestens zum Termin ab, sonst nach 30 Tagen –
// alte Links in weitergeleiteten Mails bleiben nicht ewig scharf.
const TOKEN_MAX_AGE_DAYS = 30;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly availability: AvailabilityService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  private mailTexts(locale: string | null | undefined) {
    return messages[(locale === 'en' ? 'en' : 'de') as Locale].mail;
  }

  private formatDate(date: Date, locale: string | null | undefined): string {
    return date.toLocaleString(locale === 'en' ? 'en-GB' : 'de-CH', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private async loadSlot(slotId: string) {
    const slot = await this.prisma.eventPositionSlot.findUnique({
      where: { id: slotId },
      include: {
        event: true,
        position: { include: { team: { select: { id: true, name: true } } } },
      },
    });
    if (!slot) throw new NotFoundException('Slot nicht gefunden');
    return slot;
  }

  private async ensureCanManageTeam(user: AuthUser, teamId: string): Promise<void> {
    if (!(await this.permissions.hasCapability(user, teamId, 'ASSIGN'))) {
      throw new ForbiddenException('Dir fehlt in diesem Team das Recht zum Einteilen');
    }
  }

  // --- Vorschläge -------------------------------------------

  // Sammelt die Fakten für die pure Engine (siehe suggestion-engine.ts):
  // Skills, letzter Einsatz, Einsatzdichte, Verfügbarkeit – alles in
  // Batch-Queries, damit auch große Gemeinden flott bleiben.
  async suggest(user: AuthUser, slotId: string): Promise<Suggestion[]> {
    const slot = await this.loadSlot(slotId);
    await this.ensureCanManageTeam(user, slot.position.team.id);
    const eventDate = slot.event.startsAt;

    const skills = await this.prisma.positionSkill.findMany({
      where: { positionId: slot.positionId, person: { status: 'ACTIVE' } },
      include: { person: { select: { id: true, firstName: true, lastName: true } } },
    });
    const personIds = skills.map((skill) => skill.person.id);
    if (personIds.length === 0) return [];

    const [unavailable, sameEvent, history, adjacent] = await Promise.all([
      this.availability.getUnavailablePersonIds(personIds, eventDate),
      this.prisma.assignment.findMany({
        where: { personId: { in: personIds }, slot: { eventId: slot.eventId } },
        select: { personId: true },
      }),
      // Einsatz-Historie der letzten 365 Tage vor dem Termin
      this.prisma.assignment.findMany({
        where: {
          personId: { in: personIds },
          status: { not: 'DECLINED' },
          slot: {
            event: {
              startsAt: { lt: eventDate, gte: new Date(eventDate.getTime() - 365 * 86_400_000) },
            },
          },
        },
        select: { personId: true, slot: { select: { event: { select: { startsAt: true } } } } },
      }),
      this.prisma.assignment.findMany({
        where: {
          personId: { in: personIds },
          status: { not: 'DECLINED' },
          slot: {
            eventId: { not: slot.eventId },
            event: {
              startsAt: {
                gte: new Date(eventDate.getTime() - 86_400_000),
                lte: new Date(eventDate.getTime() + 86_400_000),
              },
            },
          },
        },
        select: { personId: true },
      }),
    ]);

    const sameEventSet = new Set(sameEvent.map((a) => a.personId));
    const adjacentSet = new Set(adjacent.map((a) => a.personId));
    const lastServed = new Map<string, Date>();
    const recentCount = new Map<string, number>();
    const ninetyDaysBefore = new Date(eventDate.getTime() - 90 * 86_400_000);
    for (const entry of history) {
      const startsAt = entry.slot.event.startsAt;
      const current = lastServed.get(entry.personId);
      if (!current || startsAt > current) lastServed.set(entry.personId, startsAt);
      if (startsAt >= ninetyDaysBefore) {
        recentCount.set(entry.personId, (recentCount.get(entry.personId) ?? 0) + 1);
      }
    }

    const facts: CandidateFacts[] = skills.map((skill) => ({
      personId: skill.person.id,
      name: `${skill.person.firstName} ${skill.person.lastName}`,
      skillLevel: skill.skillLevel,
      lastServedAt: lastServed.get(skill.person.id) ?? null,
      assignmentsLast90Days: recentCount.get(skill.person.id) ?? 0,
      isUnavailable: unavailable.has(skill.person.id),
      alreadyAssignedSameEvent: sameEventSet.has(skill.person.id),
      assignedAdjacentDay: adjacentSet.has(skill.person.id),
    }));

    return scoreCandidates(facts, eventDate);
  }

  // --- Einteilen --------------------------------------------

  async assign(user: AuthUser, slotId: string, personId: string) {
    const slot = await this.loadSlot(slotId);
    await this.ensureCanManageTeam(user, slot.position.team.id);

    // Nur Personen mit dieser Position sind einteilbar – schützt vor
    // Tippfehlern und hält die Skill-Pflege ehrlich
    const skill = await this.prisma.positionSkill.findUnique({
      where: { positionId_personId: { positionId: slot.positionId, personId } },
      include: { person: true },
    });
    if (!skill || skill.person.status !== 'ACTIVE') {
      throw new ForbiddenException('Person ist dieser Position nicht zugeordnet');
    }

    // Harte Konflikte melden statt still einteilen
    if (await this.availability.isUnavailable(personId, slot.event.startsAt)) {
      throw new ConflictException({
        message: 'Person ist an diesem Termin als abwesend eingetragen',
        code: 'UNAVAILABLE',
      });
    }

    let assignment;
    try {
      assignment = await this.prisma.assignment.create({
        data: { slotId, personId, assignedById: user.personId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Person ist in diesem Slot bereits eingeteilt');
      }
      throw error;
    }

    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Assignment',
      entityId: assignment.id,
    });
    await this.sendAssignmentMail(assignment.id);
    return assignment;
  }

  async remove(user: AuthUser, assignmentId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { slot: { include: { position: { select: { teamId: true } } } } },
    });
    if (!assignment) throw new NotFoundException();
    await this.ensureCanManageTeam(user, assignment.slot.position.teamId);
    await this.prisma.assignment.delete({ where: { id: assignmentId } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'Assignment',
      entityId: assignmentId,
    });
  }

  // Einteilungs-Mail mit Accept/Decline-Links (tokenbasiert, ohne Login
  // nutzbar). Der Klartext-Token existiert nur in dieser Mail.
  private async sendAssignmentMail(assignmentId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        person: true,
        slot: { include: { event: true, position: true } },
      },
    });
    if (!assignment.person.email) return; // Person ohne E-Mail: Leiter informiert mündlich

    const token = generateToken();
    const eventStart = assignment.slot.event.startsAt;
    const maxAge = new Date(Date.now() + TOKEN_MAX_AGE_DAYS * 86_400_000);
    await this.prisma.responseToken.create({
      data: {
        assignmentId,
        tokenHash: hashToken(token),
        expiresAt: eventStart < maxAge ? eventStart : maxAge,
      },
    });

    const texts = this.mailTexts(assignment.person.locale);
    const vars = {
      firstName: assignment.person.firstName,
      eventTitle: assignment.slot.event.title,
      date: this.formatDate(eventStart, assignment.person.locale),
      position: assignment.slot.position.name,
      acceptUrl: `${env.APP_URL}/respond/${token}?action=accept`,
      declineUrl: `${env.APP_URL}/respond/${token}?action=decline`,
    };
    await this.mailer.send({
      to: assignment.person.email,
      subject: interpolate(texts.assignedSubject, vars),
      text: interpolate(texts.assignedBody, vars),
    });
    await this.prisma.notificationLog.create({
      data: { personId: assignment.personId, assignmentId, kind: 'ASSIGNED' },
    });
  }

  // --- Zusage/Absage per Token (ohne Login) ------------------

  private async loadTokenOrFail(token: string) {
    const record = await this.prisma.responseToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        assignment: {
          include: {
            person: { select: { id: true, firstName: true, locale: true } },
            slot: { include: { event: true, position: { include: { team: true } } } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException();
    if (record.usedAt) throw new GoneException({ message: 'respond.alreadyUsed' });
    if (record.expiresAt < new Date()) throw new GoneException({ message: 'respond.expired' });
    return record;
  }

  // Info-Ansicht: bewusst nur Vorname + Termin + Position – die Seite ist
  // ohne Login erreichbar, ein weitergeleiteter Link darf keine
  // Kontaktdaten preisgeben (siehe Threat Model)
  async tokenInfo(token: string) {
    const record = await this.loadTokenOrFail(token);
    return {
      firstName: record.assignment.person.firstName,
      eventTitle: record.assignment.slot.event.title,
      startsAt: record.assignment.slot.event.startsAt,
      location: record.assignment.slot.event.location,
      position: record.assignment.slot.position.name,
      status: record.assignment.status,
    };
  }

  async respondByToken(token: string, status: AssignmentStatus, reason?: string) {
    const record = await this.loadTokenOrFail(token);
    await this.prisma.$transaction([
      this.prisma.responseToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() }, // single-use
      }),
      this.prisma.assignment.update({
        where: { id: record.assignmentId },
        data: {
          status,
          respondedAt: new Date(),
          declineReason: status === 'DECLINED' ? (reason ?? null) : null,
        },
      }),
    ]);
    this.audit.log({
      actorId: record.assignment.person.id,
      action: 'UPDATE',
      entityType: 'Assignment',
      entityId: record.assignmentId,
      changedFields: ['status'],
    });
    if (status === 'DECLINED') {
      await this.notifyLeadersOfDecline(record.assignmentId, reason);
    }
    return { status };
  }

  // --- Zusage/Absage eingeloggt ("Meine Dienste") ------------

  async myAssignments(user: AuthUser) {
    const assignments = await this.prisma.assignment.findMany({
      where: {
        personId: user.personId,
        slot: { event: { startsAt: { gte: new Date() }, status: 'PUBLISHED' } },
      },
      include: {
        slot: { include: { event: true, position: true } },
        replacementRequests: {
          where: { status: 'PENDING' },
          include: { candidate: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { slot: { event: { startsAt: 'asc' } } },
    });
    return assignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      eventTitle: assignment.slot.event.title,
      startsAt: assignment.slot.event.startsAt,
      location: assignment.slot.event.location,
      position: assignment.slot.position.name,
      // Läuft gerade eine Vertretungsanfrage? (max. eine offen)
      pendingReplacement: assignment.replacementRequests[0]
        ? {
            candidateName: `${assignment.replacementRequests[0].candidate.firstName} ${assignment.replacementRequests[0].candidate.lastName}`,
          }
        : null,
    }));
  }

  async respondMine(
    user: AuthUser,
    assignmentId: string,
    status: AssignmentStatus,
    reason?: string,
  ) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    // Nur die eingeteilte Person selbst darf antworten
    if (!assignment || assignment.personId !== user.personId) throw new NotFoundException();
    await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        status,
        respondedAt: new Date(),
        declineReason: status === 'DECLINED' ? (reason ?? null) : null,
      },
    });
    if (status === 'DECLINED') {
      await this.notifyLeadersOfDecline(assignmentId, reason);
    }
    return { status };
  }

  // Bei Absage: Teamleiter benachrichtigen, inkl. Top-3-Ersatzvorschlägen
  // aus der Engine – der Leiter kann direkt reagieren.
  private async notifyLeadersOfDecline(assignmentId: string, reason?: string): Promise<void> {
    const assignment = await this.prisma.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        person: { select: { firstName: true, lastName: true } },
        slot: { include: { event: true, position: { include: { team: true } } } },
      },
    });
    const leaders = await this.prisma.teamMembership.findMany({
      where: { teamId: assignment.slot.position.teamId, role: 'LEADER' },
      include: { person: true },
    });
    if (leaders.length === 0) return;

    // Vorschläge im Namen des Systems berechnen (Admin-Sicht)
    const suggestions = await this.suggestForSlot(assignment.slotId);
    const topThree = suggestions
      .slice(0, 3)
      .map((s, index) => `${index + 1}. ${s.name}`)
      .join('\n');

    for (const leader of leaders) {
      if (!leader.person.email) continue;
      const texts = this.mailTexts(leader.person.locale);
      const vars = {
        leaderName: leader.person.firstName,
        personName: `${assignment.person.firstName} ${assignment.person.lastName}`,
        position: assignment.slot.position.name,
        eventTitle: assignment.slot.event.title,
        date: this.formatDate(assignment.slot.event.startsAt, leader.person.locale),
        reason: reason ? `\n\nGrund: ${reason}` : '',
        suggestions: topThree || '—',
        planUrl: `${env.APP_URL}/plans/${assignment.slot.eventId}`,
      };
      await this.mailer.send({
        to: leader.person.email,
        subject: interpolate(texts.declinedAlertSubject, vars),
        text: interpolate(texts.declinedAlertBody, vars),
      });
      await this.prisma.notificationLog.create({
        data: { personId: leader.personId, assignmentId, kind: 'DECLINED_ALERT' },
      });
    }
  }

  // Variante ohne Berechtigungsprüfung – für System-Mails und Flows, die
  // ihre Berechtigung selbst prüfen (z. B. Vertretungs-Kandidatenliste)
  async suggestForSlot(slotId: string): Promise<Suggestion[]> {
    const systemUser: AuthUser = { accountId: 'system', personId: 'system', globalRole: 'ADMIN' };
    return this.suggest(systemUser, slotId);
  }
}
