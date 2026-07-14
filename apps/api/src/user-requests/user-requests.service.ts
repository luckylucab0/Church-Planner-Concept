import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserAccountRequestStatus } from '@prisma/client';
import { interpolate, Locale, messages } from '@serveflow/shared';
import { CreateUserRequestDto } from './dto/user-requests.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { InviteService } from '../auth/invite.service';
import { PermissionsService } from '../authz/permissions.service';
import { env } from '../common/config/env';
import { MailerService } from '../notifications/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

// Benutzer-Anträge: Teamleiter erfassen neue Mitarbeiter für ihr Team,
// Admins entscheiden. Genehmigung erstellt die Person (inkl.
// Mitgliedschaft im beantragten Team) und stößt den Einladungs-Flow an –
// die Personenhoheit bleibt damit beim Admin, der Leiter spart sich den
// Umweg über Zuruf-Mails.
@Injectable()
export class UserRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly invites: InviteService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  private mailTexts(locale: string | null | undefined) {
    return messages[(locale === 'en' ? 'en' : 'de') as Locale].mail;
  }

  async create(user: AuthUser, dto: CreateUserRequestDto) {
    const leaderTeamIds = await this.permissions.getLeaderTeamIds(user.personId);
    if (!leaderTeamIds.includes(dto.teamId)) {
      throw new ForbiddenException('Nur Leiter des gewählten Teams können Benutzer beantragen');
    }

    const email = dto.email.trim().toLowerCase();
    const existingPerson = await this.prisma.person.findUnique({ where: { email } });
    if (existingPerson) {
      throw new ConflictException({ message: 'userRequests.emailExists' });
    }
    const pending = await this.prisma.userAccountRequest.findFirst({
      where: { email, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException({ message: 'userRequests.alreadyPending' });
    }

    const request = await this.prisma.userAccountRequest.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        teamId: dto.teamId,
        requestedById: user.personId,
      },
      include: { team: { select: { name: true } }, requestedBy: true },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'UserAccountRequest',
      entityId: request.id,
    });
    await this.notifyAdmins(request);
    return this.toView(request);
  }

  async list(user: AuthUser, status?: UserAccountRequestStatus) {
    const where: Prisma.UserAccountRequestWhereInput = {
      ...(this.permissions.isAdmin(user) ? {} : { requestedById: user.personId }),
      ...(status ? { status } : {}),
    };
    const requests = await this.prisma.userAccountRequest.findMany({
      where,
      include: { team: { select: { name: true } }, requestedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.toView(r));
  }

  async approve(user: AuthUser, requestId: string, comment?: string) {
    const request = await this.loadPending(requestId);

    let personId: string;
    try {
      const [person] = await this.prisma.$transaction([
        this.prisma.person.create({
          data: {
            firstName: request.firstName,
            lastName: request.lastName,
            email: request.email,
            phone: request.phone,
            privacySettings: { create: {} },
            // Direkt ins Team des Antragstellers – dafür wurde die
            // Person ja beantragt
            memberships: { create: { teamId: request.teamId, role: 'MEMBER' } },
          },
        }),
        this.prisma.userAccountRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            reviewedById: user.personId,
            reviewedAt: new Date(),
            reviewComment: comment,
          },
        }),
      ]);
      personId = person.id;
    } catch (error) {
      // E-Mail wurde seit Antragstellung anderweitig vergeben
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: 'userRequests.emailExists' });
      }
      throw error;
    }
    await this.prisma.userAccountRequest.update({
      where: { id: requestId },
      data: { createdPersonId: personId },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Person',
      entityId: personId,
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'UserAccountRequest',
      entityId: requestId,
      changedFields: ['status', 'reviewComment'],
    });

    await this.invites.sendInvite(user, personId);
    await this.notifyRequester(requestId, 'APPROVED', comment);
  }

  async reject(user: AuthUser, requestId: string, comment?: string) {
    const request = await this.loadPending(requestId);
    await this.prisma.userAccountRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewedById: user.personId,
        reviewedAt: new Date(),
        reviewComment: comment,
      },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'UserAccountRequest',
      entityId: requestId,
      changedFields: ['status', 'reviewComment'],
    });
    await this.notifyRequester(requestId, 'REJECTED', comment);
  }

  private async loadPending(requestId: string) {
    const request = await this.prisma.userAccountRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException();
    if (request.status !== 'PENDING') {
      throw new ConflictException({ message: 'userRequests.alreadyDecided' });
    }
    return request;
  }

  private async notifyAdmins(request: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    team: { name: string };
    requestedBy: { firstName: string; lastName: string };
  }) {
    const admins = await this.prisma.userAccount.findMany({
      where: { globalRole: 'ADMIN' },
      include: { person: true },
    });
    for (const admin of admins) {
      if (!admin.person.email) continue;
      const texts = this.mailTexts(admin.person.locale);
      const vars = {
        adminName: admin.person.firstName,
        requesterName: `${request.requestedBy.firstName} ${request.requestedBy.lastName}`,
        personName: `${request.firstName} ${request.lastName}`,
        email: request.email,
        teamName: request.team.name,
        reviewUrl: `${env.APP_URL}/people`,
      };
      await this.mailer.send({
        to: admin.person.email,
        subject: interpolate(texts.userRequestAdminSubject, vars),
        text: interpolate(texts.userRequestAdminBody, vars),
      });
      await this.prisma.notificationLog.create({
        data: { personId: admin.personId, kind: 'USER_REQUEST' },
      });
    }
  }

  private async notifyRequester(
    requestId: string,
    outcome: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    const request = await this.prisma.userAccountRequest.findUnique({
      where: { id: requestId },
      include: { team: { select: { name: true } }, requestedBy: true },
    });
    if (!request?.requestedBy.email) return;
    const texts = this.mailTexts(request.requestedBy.locale);
    const vars = {
      firstName: request.requestedBy.firstName,
      personName: `${request.firstName} ${request.lastName}`,
      teamName: request.team.name,
      comment: comment ? `\n\nKommentar: ${comment}` : '',
    };
    await this.mailer.send({
      to: request.requestedBy.email,
      subject: interpolate(
        outcome === 'APPROVED'
          ? texts.userRequestApprovedSubject
          : texts.userRequestRejectedSubject,
        vars,
      ),
      text: interpolate(
        outcome === 'APPROVED' ? texts.userRequestApprovedBody : texts.userRequestRejectedBody,
        vars,
      ),
    });
    await this.prisma.notificationLog.create({
      data: { personId: request.requestedById, kind: 'USER_REQUEST_RESULT' },
    });
  }

  private toView(request: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    teamId: string;
    status: UserAccountRequestStatus;
    reviewComment: string | null;
    createdAt: Date;
    team: { name: string };
    requestedBy: { firstName: string; lastName: string };
  }) {
    return {
      id: request.id,
      firstName: request.firstName,
      lastName: request.lastName,
      email: request.email,
      phone: request.phone,
      teamId: request.teamId,
      teamName: request.team.name,
      requestedByName: `${request.requestedBy.firstName} ${request.requestedBy.lastName}`,
      status: request.status,
      reviewComment: request.reviewComment,
      createdAt: request.createdAt,
    };
  }
}
