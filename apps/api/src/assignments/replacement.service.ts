import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { interpolate, Locale, messages } from '@serveflow/shared';
import { AssignmentsService } from './assignments.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { env } from '../common/config/env';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { MailerService } from '../notifications/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

// Wie Respond-Tokens: spätestens zum Termin ungültig, sonst nach 14 Tagen –
// eine unbeantwortete Vertretungsanfrage soll nicht ewig offen bleiben.
const REQUEST_MAX_AGE_DAYS = 14;

// Vertretung (Swap & Replace): Die eingeteilte Person sucht sich selbst
// eine Vertretung, statt nur abzusagen. Die angefragte Person bekommt
// einen Token-Link (ohne Login nutzbar); bei Zusage wandert die
// Einteilung auf sie über, Teamleitung und anfragende Person werden
// informiert.
@Injectable()
export class ReplacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentsService,
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

  // Nur die eingeteilte Person selbst – Vertretung ist ihr Workflow.
  private async loadOwnAssignment(user: AuthUser, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        person: true,
        slot: { include: { event: true, position: { include: { team: true } } } },
      },
    });
    if (!assignment || assignment.personId !== user.personId) throw new NotFoundException();
    return assignment;
  }

  // Kandidaten, die die Person selbst anfragen darf: dieselben harten
  // Filter wie bei Teamleiter-Vorschlägen (Position, verfügbar, nicht am
  // selben Termin). Bewusst nur Name – keine Kontaktdaten, und die
  // Fairness-Details bleiben dem Leiter-Workflow vorbehalten.
  async candidates(user: AuthUser, assignmentId: string) {
    const assignment = await this.loadOwnAssignment(user, assignmentId);
    if (assignment.slot.event.startsAt < new Date()) {
      throw new BadRequestException('Termin liegt in der Vergangenheit');
    }
    const suggestions = await this.assignments.suggestForSlot(assignment.slotId);
    return suggestions
      .filter((s) => s.personId !== user.personId)
      .map((s) => ({ personId: s.personId, name: s.name }));
  }

  async request(user: AuthUser, assignmentId: string, candidatePersonId: string) {
    const assignment = await this.loadOwnAssignment(user, assignmentId);
    if (assignment.status === 'DECLINED') {
      throw new BadRequestException('Für eine abgesagte Einteilung gibt es nichts zu vertreten');
    }
    if (assignment.slot.event.startsAt < new Date()) {
      throw new BadRequestException('Termin liegt in der Vergangenheit');
    }
    if (candidatePersonId === user.personId) {
      throw new BadRequestException('Du kannst dich nicht selbst anfragen');
    }
    // Eine Anfrage nach der anderen – verhindert, dass zwei Personen
    // gleichzeitig zusagen und sich gegenseitig überschreiben
    const pending = await this.prisma.replacementRequest.findFirst({
      where: { assignmentId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException('Es läuft bereits eine Vertretungsanfrage');
    }

    // Gleiche Eignungsprüfung wie beim Einteilen durch die Teamleitung
    const skill = await this.prisma.positionSkill.findUnique({
      where: {
        positionId_personId: {
          positionId: assignment.slot.positionId,
          personId: candidatePersonId,
        },
      },
      include: { person: true },
    });
    if (!skill || skill.person.status !== 'ACTIVE') {
      throw new ForbiddenException('Person ist dieser Position nicht zugeordnet');
    }
    if (!skill.person.email) {
      throw new BadRequestException('Person hat keine E-Mail-Adresse hinterlegt');
    }
    if (await this.availability.isUnavailable(candidatePersonId, assignment.slot.event.startsAt)) {
      throw new ConflictException({
        message: 'Person ist an diesem Termin als abwesend eingetragen',
        code: 'UNAVAILABLE',
      });
    }
    const sameEvent = await this.prisma.assignment.findFirst({
      where: {
        personId: candidatePersonId,
        status: { not: 'DECLINED' },
        slot: { eventId: assignment.slot.eventId },
      },
    });
    if (sameEvent) {
      throw new ConflictException('Person ist an diesem Termin bereits eingeteilt');
    }

    const token = generateToken();
    const eventStart = assignment.slot.event.startsAt;
    const maxAge = new Date(Date.now() + REQUEST_MAX_AGE_DAYS * 86_400_000);
    const request = await this.prisma.replacementRequest.create({
      data: {
        assignmentId,
        candidatePersonId,
        tokenHash: hashToken(token),
        expiresAt: eventStart < maxAge ? eventStart : maxAge,
      },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'ReplacementRequest',
      entityId: request.id,
    });

    const texts = this.mailTexts(skill.person.locale);
    const vars = {
      firstName: skill.person.firstName,
      requesterName: `${assignment.person.firstName} ${assignment.person.lastName}`,
      eventTitle: assignment.slot.event.title,
      date: this.formatDate(eventStart, skill.person.locale),
      position: assignment.slot.position.name,
      acceptUrl: `${env.APP_URL}/replacement/${token}?action=accept`,
      declineUrl: `${env.APP_URL}/replacement/${token}?action=decline`,
    };
    await this.mailer.send({
      to: skill.person.email,
      subject: interpolate(texts.replacementRequestSubject, vars),
      text: interpolate(texts.replacementRequestBody, vars),
    });
    await this.prisma.notificationLog.create({
      data: { personId: candidatePersonId, assignmentId, kind: 'REPLACEMENT_REQUEST' },
    });

    return {
      id: request.id,
      status: request.status,
      candidateName: `${skill.person.firstName} ${skill.person.lastName}`,
    };
  }

  // Anfrage zurückziehen (nur die anfragende Person, nur solange offen)
  async cancel(user: AuthUser, assignmentId: string): Promise<void> {
    await this.loadOwnAssignment(user, assignmentId);
    const { count } = await this.prisma.replacementRequest.updateMany({
      where: { assignmentId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Keine offene Vertretungsanfrage');
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'ReplacementRequest',
      entityId: assignmentId,
      changedFields: ['status'],
    });
  }

  // --- Token-Flow (öffentlich, ohne Login) --------------------

  private async loadTokenOrFail(token: string) {
    const record = await this.prisma.replacementRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        candidate: true,
        assignment: {
          include: {
            person: true,
            slot: { include: { event: true, position: { include: { team: true } } } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException();
    if (record.status !== 'PENDING') throw new GoneException({ message: 'respond.alreadyUsed' });
    if (record.expiresAt < new Date()) throw new GoneException({ message: 'respond.expired' });
    return record;
  }

  // Wie beim Respond-Token: nur Vornamen + Termin, keine Kontaktdaten –
  // der Link ist ohne Login nutzbar (siehe Threat Model)
  async tokenInfo(token: string) {
    const record = await this.loadTokenOrFail(token);
    return {
      firstName: record.candidate.firstName,
      requesterFirstName: record.assignment.person.firstName,
      eventTitle: record.assignment.slot.event.title,
      startsAt: record.assignment.slot.event.startsAt,
      location: record.assignment.slot.event.location,
      position: record.assignment.slot.position.name,
    };
  }

  async respondByToken(token: string, accept: boolean) {
    const record = await this.loadTokenOrFail(token);
    const requester = record.assignment.person;
    const candidateName = `${record.candidate.firstName} ${record.candidate.lastName}`;

    if (!accept) {
      await this.prisma.replacementRequest.update({
        where: { id: record.id },
        data: { status: 'DECLINED', respondedAt: new Date() },
      });
      await this.notifyRequester(record, false);
      return { status: 'DECLINED' as const };
    }

    // Übernahme: alte Einteilung wird zur dokumentierten Absage, die
    // Vertretung startet direkt als Zusage (sie hat ja aktiv übernommen)
    try {
      await this.prisma.$transaction([
        this.prisma.replacementRequest.update({
          where: { id: record.id },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        }),
        this.prisma.assignment.update({
          where: { id: record.assignmentId },
          data: {
            status: 'DECLINED',
            respondedAt: new Date(),
            declineReason: `Vertretung: ${candidateName}`,
          },
        }),
        this.prisma.assignment.create({
          data: {
            slotId: record.assignment.slotId,
            personId: record.candidatePersonId,
            status: 'ACCEPTED',
            assignedById: requester.id,
            respondedAt: new Date(),
          },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Du bist in diesem Slot bereits eingeteilt');
      }
      throw error;
    }
    this.audit.log({
      actorId: record.candidatePersonId,
      action: 'UPDATE',
      entityType: 'ReplacementRequest',
      entityId: record.id,
      changedFields: ['status'],
    });

    await this.notifyRequester(record, true);
    await this.notifyLeaders(record);
    return { status: 'ACCEPTED' as const };
  }

  private async notifyRequester(
    record: Awaited<ReturnType<ReplacementService['loadTokenOrFail']>>,
    accepted: boolean,
  ): Promise<void> {
    const requester = record.assignment.person;
    if (!requester.email) return;
    const texts = this.mailTexts(requester.locale);
    const vars = {
      firstName: requester.firstName,
      candidateName: `${record.candidate.firstName} ${record.candidate.lastName}`,
      eventTitle: record.assignment.slot.event.title,
      date: this.formatDate(record.assignment.slot.event.startsAt, requester.locale),
      position: record.assignment.slot.position.name,
    };
    await this.mailer.send({
      to: requester.email,
      subject: interpolate(
        accepted ? texts.replacementAcceptedSubject : texts.replacementDeclinedSubject,
        vars,
      ),
      text: interpolate(
        accepted ? texts.replacementAcceptedBody : texts.replacementDeclinedBody,
        vars,
      ),
    });
    await this.prisma.notificationLog.create({
      data: {
        personId: requester.id,
        assignmentId: record.assignmentId,
        kind: 'REPLACEMENT_RESULT',
      },
    });
  }

  private async notifyLeaders(
    record: Awaited<ReturnType<ReplacementService['loadTokenOrFail']>>,
  ): Promise<void> {
    const leaders = await this.prisma.teamMembership.findMany({
      where: { teamId: record.assignment.slot.position.teamId, role: 'LEADER' },
      include: { person: true },
    });
    for (const leader of leaders) {
      if (!leader.person.email) continue;
      const texts = this.mailTexts(leader.person.locale);
      const vars = {
        leaderName: leader.person.firstName,
        personName: `${record.assignment.person.firstName} ${record.assignment.person.lastName}`,
        candidateName: `${record.candidate.firstName} ${record.candidate.lastName}`,
        eventTitle: record.assignment.slot.event.title,
        date: this.formatDate(record.assignment.slot.event.startsAt, leader.person.locale),
        position: record.assignment.slot.position.name,
        planUrl: `${env.APP_URL}/plans/${record.assignment.slot.eventId}`,
      };
      await this.mailer.send({
        to: leader.person.email,
        subject: interpolate(texts.replacementLeaderSubject, vars),
        text: interpolate(texts.replacementLeaderBody, vars),
      });
      await this.prisma.notificationLog.create({
        data: {
          personId: leader.personId,
          assignmentId: record.assignmentId,
          kind: 'REPLACEMENT_RESULT',
        },
      });
    }
  }
}
