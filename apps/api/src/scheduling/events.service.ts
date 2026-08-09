import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { CreateEventDto, SetPlanDto, SetSlotsDto, UpdateEventDto } from './dto/scheduling.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // Termine anlegen/ändern darf, wer in irgendeinem Team MANAGE_EVENTS hat:
  // ein Gottesdienst gehört keinem einzelnen Team, deshalb dieselbe
  // teamübergreifende Prüfung wie bei EDIT_PLAN und MANAGE_SONGS.
  // Nicht delegierbar bleiben Serien-Konfiguration und das harte Löschen –
  // die hängen weiter am AdminGuard im Controller.
  private async ensureCanManageEvents(user: AuthUser): Promise<void> {
    if (await this.permissions.hasCapabilityInAnyTeam(user, 'MANAGE_EVENTS')) return;
    throw new ForbiddenException('Dir fehlt das Recht, Termine zu verwalten');
  }

  // Mitglieder sehen nur veröffentlichte Termine; wer plant, sieht auch
  // Entwürfe (PLANNED). MANAGE_EVENTS impliziert das: ein neu angelegter
  // Termin entsteht als Entwurf, ohne diese Zeile wäre er für die anlegende
  // Person sofort unsichtbar.
  private async visibleStatuses(user: AuthUser): Promise<EventStatus[]> {
    const canSeeDrafts =
      (await this.permissions.hasCapabilityInAnyTeam(user, 'VIEW_DRAFTS')) ||
      (await this.permissions.hasCapabilityInAnyTeam(user, 'MANAGE_EVENTS'));
    if (canSeeDrafts) {
      return ['PLANNED', 'PUBLISHED', 'CANCELLED'];
    }
    return ['PUBLISHED'];
  }

  async list(user: AuthUser, from?: Date, to?: Date) {
    const statuses = await this.visibleStatuses(user);
    const where: Prisma.EventWhereInput = {
      status: { in: statuses },
      startsAt: {
        gte: from ?? new Date(Date.now() - 7 * 86_400_000),
        ...(to ? { lte: to } : {}),
      },
    };
    const events = await this.prisma.event.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: {
        slots: {
          include: {
            position: { include: { team: { select: { name: true, color: true } } } },
            assignments: { select: { status: true } },
          },
        },
      },
    });
    // Kompakte Listen-Ansicht: Besetzungsgrad statt aller Namen
    return events.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      status: event.status,
      totalRequired: event.slots.reduce((sum, slot) => sum + slot.requiredCount, 0),
      totalAccepted: event.slots.reduce(
        (sum, slot) => sum + slot.assignments.filter((a) => a.status === 'ACCEPTED').length,
        0,
      ),
      totalRequested: event.slots.reduce(
        (sum, slot) => sum + slot.assignments.filter((a) => a.status === 'REQUESTED').length,
        0,
      ),
    }));
  }

  // Detail: kompletter Plan mit Positionen, eingeteilten Personen und
  // deren Zusage-Status (angefragt/zugesagt/abgesagt sichtbar im Plan)
  async get(user: AuthUser, eventId: string) {
    const statuses = await this.visibleStatuses(user);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: { in: statuses } },
      include: {
        slots: {
          include: {
            position: { include: { team: { select: { id: true, name: true, color: true } } } },
            assignments: {
              include: { person: { select: { id: true, firstName: true, lastName: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
          // Feste Reihenfolge: ohne orderBy würden Slots nach einem UPDATE
          // (z. B. Freigabe-Toggle) in Heap-Reihenfolge zurückkommen und
          // die Kachel spränge ans Listenende.
          orderBy: [
            { position: { team: { name: 'asc' } } },
            { position: { name: 'asc' } },
            { id: 'asc' },
          ],
        },
        planItems: { include: planItemInclude, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!event) throw new NotFoundException();

    const isAdmin = this.permissions.isAdmin(user);
    // Teams, in denen der Nutzer einteilen darf (LEADER implizit,
    // andere Rollen laut Rechtematrix)
    const ledTeamIds = isAdmin
      ? event.slots.map((s) => s.position.team.id)
      : await this.permissions.getTeamIdsWithCapability(user, 'ASSIGN');

    // Für canSignup: Teams, in denen meine Rolle das Recht SELF_SIGNUP hat
    // (Admins überall – wie der hasCapability-Bypass im SignupService) +
    // ob ich an diesem Termin schon dran bin
    const signupTeamIds = new Set(
      isAdmin
        ? event.slots.map((s) => s.position.team.id)
        : await this.permissions.getTeamIdsWithCapability(user, 'SELF_SIGNUP'),
    );
    const alreadyInEvent = event.slots.some((slot) =>
      slot.assignments.some((a) => a.person.id === user.personId && a.status !== 'DECLINED'),
    );
    const inFuture = event.startsAt >= new Date();

    return {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      status: event.status,
      // canEditPlan steuert nur die UI – setPlan() prüft serverseitig selbst
      canEditPlan: await this.permissions.hasCapabilityInAnyTeam(user, 'EDIT_PLAN'),
      // dito: bearbeiten/veröffentlichen/absagen und Slots pflegen
      canManageEvent: await this.permissions.hasCapabilityInAnyTeam(user, 'MANAGE_EVENTS'),
      planItems: event.planItems.map(mapPlanItem),
      slots: event.slots.map((slot) => {
        const canAssign = ledTeamIds.includes(slot.position.team.id);
        const taken = slot.assignments.filter((a) => a.status !== 'DECLINED').length;
        return {
          id: slot.id,
          requiredCount: slot.requiredCount,
          openForSignup: slot.openForSignup,
          position: {
            id: slot.position.id,
            name: slot.position.name,
            team: slot.position.team,
          },
          // canAssign steuert nur die UI – die Assignments-API prüft selbst
          canAssign,
          // "Mich eintragen" anbieten? Nur UI-Hinweis, die Signup-API prüft
          // beim POST erneut (inkl. Abwesenheit, die hier zu teuer wäre).
          canSignup:
            event.status === 'PUBLISHED' &&
            inFuture &&
            signupTeamIds.has(slot.position.team.id) &&
            taken < slot.requiredCount &&
            !alreadyInEvent &&
            (slot.openForSignup || canAssign),
          assignments: slot.assignments.map((assignment) => ({
            id: assignment.id,
            personId: assignment.person.id,
            personName: `${assignment.person.firstName} ${assignment.person.lastName}`,
            status: assignment.status,
            declineReason: assignment.declineReason,
          })),
        };
      }),
    };
  }

  async create(user: AuthUser, dto: CreateEventDto) {
    await this.ensureCanManageEvents(user);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    assertRange(startsAt, endsAt);
    // Slots optional aus dem Template des Typs übernehmen
    const template = dto.serviceTypeId
      ? await this.prisma.serviceTypePosition.findMany({
          where: { serviceTypeId: dto.serviceTypeId },
        })
      : [];
    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        startsAt,
        endsAt,
        location: dto.location,
        serviceTypeId: dto.serviceTypeId,
        slots: {
          create: template.map((item) => ({
            positionId: item.positionId,
            requiredCount: item.requiredCount,
          })),
        },
      },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Event',
      entityId: event.id,
    });
    return event;
  }

  async update(user: AuthUser, eventId: string, dto: UpdateEventDto) {
    // Rechte vor Existenz: sonst verrät ein 404 vs. 403, welche IDs es gibt
    await this.ensureCanManageEvents(user);
    const current = await this.ensureExists(eventId);
    // Teil-Update gegen den gespeicherten Stand prüfen – ein PATCH, das nur
    // startsAt schickt, darf den Termin nicht rückwärts laufen lassen
    assertRange(
      dto.startsAt ? new Date(dto.startsAt) : current.startsAt,
      dto.endsAt ? new Date(dto.endsAt) : current.endsAt,
    );
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...dto,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Event',
      entityId: eventId,
      changedFields: Object.keys(dto),
    });
    return event;
  }

  async delete(user: AuthUser, eventId: string): Promise<void> {
    await this.ensureExists(eventId);
    await this.prisma.event.delete({ where: { id: eventId } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'Event',
      entityId: eventId,
    });
  }

  // Slots ersetzen; bestehende Slots (inkl. Einteilungen) für Positionen,
  // die bleiben, werden nur im requiredCount angepasst statt neu erzeugt –
  // sonst gingen Zusagen beim Umplanen verloren.
  async setSlots(user: AuthUser, eventId: string, dto: SetSlotsDto) {
    await this.ensureCanManageEvents(user);
    await this.ensureExists(eventId);
    const existing = await this.prisma.eventPositionSlot.findMany({ where: { eventId } });
    const wantedByPosition = new Map(dto.items.map((item) => [item.positionId, item]));

    // Ein entfernter Slot nimmt seine Einteilungen per Cascade mit. Das ist
    // gewollt, darf aber nicht unbemerkt passieren: ohne force wird es
    // abgelehnt, damit die UI erst nachfragen kann. 409 statt 403, sonst
    // wäre es von einer fehlenden Berechtigung nicht zu unterscheiden.
    const dropped = existing.filter((slot) => !wantedByPosition.has(slot.positionId));
    if (!dto.force && dropped.length > 0) {
      const affected = await this.prisma.assignment.count({
        where: { slotId: { in: dropped.map((slot) => slot.id) }, status: { not: 'DECLINED' } },
      });
      if (affected > 0) {
        throw new ConflictException(
          `Für eine zu entfernende Position sind noch ${affected} Personen eingeteilt`,
        );
      }
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const slot of existing) {
      const wanted = wantedByPosition.get(slot.positionId);
      if (!wanted) {
        operations.push(this.prisma.eventPositionSlot.delete({ where: { id: slot.id } }));
      } else if (wanted.requiredCount !== slot.requiredCount) {
        operations.push(
          this.prisma.eventPositionSlot.update({
            where: { id: slot.id },
            data: { requiredCount: wanted.requiredCount },
          }),
        );
      }
      wantedByPosition.delete(slot.positionId);
    }
    for (const item of wantedByPosition.values()) {
      operations.push(
        this.prisma.eventPositionSlot.create({
          data: { eventId, positionId: item.positionId, requiredCount: item.requiredCount },
        }),
      );
    }
    await this.prisma.$transaction(operations);
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Event',
      entityId: eventId,
      changedFields: ['slots'],
    });
    return this.prisma.eventPositionSlot.findMany({
      where: { eventId },
      include: { position: true },
    });
  }

  // Ablaufplan komplett ersetzen: der Editor arbeitet auf der ganzen
  // Liste (Reorder, Einfügen, Löschen), ein transaktionales Replace ist
  // robuster als Einzel-Operationen mit Sortier-Arithmetik.
  async setPlan(user: AuthUser, eventId: string, dto: SetPlanDto) {
    await this.ensureExists(eventId);
    if (!(await this.permissions.hasCapabilityInAnyTeam(user, 'EDIT_PLAN'))) {
      throw new ForbiddenException('Dir fehlt das Recht, den Ablaufplan zu bearbeiten');
    }

    // Arrangement muss zum gewählten Lied gehören – sonst stünde im Plan
    // eine Tonart, die es für dieses Lied gar nicht gibt
    const arrangementIds = dto.items.map((i) => i.arrangementId).filter(Boolean) as string[];
    if (arrangementIds.length > 0) {
      const arrangements = await this.prisma.songArrangement.findMany({
        where: { id: { in: arrangementIds } },
        select: { id: true, songId: true },
      });
      const songByArrangement = new Map(arrangements.map((a) => [a.id, a.songId]));
      for (const item of dto.items) {
        if (item.arrangementId && songByArrangement.get(item.arrangementId) !== item.songId) {
          throw new BadRequestException('Arrangement gehört nicht zum gewählten Lied');
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.servicePlanItem.deleteMany({ where: { eventId } }),
      this.prisma.servicePlanItem.createMany({
        data: dto.items.map((item, index) => ({
          eventId,
          sortOrder: index,
          kind: item.kind ?? 'OTHER',
          title: item.title,
          durationMinutes: item.durationMinutes,
          songId: item.songId ?? null,
          arrangementId: item.arrangementId ?? null,
          responsiblePersonId: item.responsiblePersonId ?? null,
          notes: item.notes ?? null,
        })),
      }),
    ]);
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Event',
      entityId: eventId,
      changedFields: ['planItems'],
    });

    const items = await this.prisma.servicePlanItem.findMany({
      where: { eventId },
      include: planItemInclude,
      orderBy: { sortOrder: 'asc' },
    });
    return items.map(mapPlanItem);
  }

  private async ensureExists(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundException();
    return event;
  }
}

// Ohne diese Prüfung ließe sich ein Termin anlegen, der vor seinem Beginn
// endet – die Ablauf-Uhrzeiten und der iCal-Export rechnen dann Unsinn.
function assertRange(startsAt: Date, endsAt: Date): void {
  if (endsAt <= startsAt) {
    throw new BadRequestException('Das Ende muss nach dem Beginn liegen');
  }
}

// Include + Mapping für Ablaufpunkte an einer Stelle – get() und
// setPlan() liefern exakt dieselbe Struktur an die UI.
const planItemInclude = {
  song: { select: { id: true, title: true, defaultKey: true, tempoBpm: true, ccliNumber: true } },
  arrangement: { select: { id: true, name: true, key: true } },
  responsiblePerson: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ServicePlanItemInclude;

type PlanItemWithRelations = Prisma.ServicePlanItemGetPayload<{ include: typeof planItemInclude }>;

function mapPlanItem(item: PlanItemWithRelations) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    durationMinutes: item.durationMinutes,
    notes: item.notes,
    song: item.song,
    arrangement: item.arrangement,
    responsiblePerson: item.responsiblePerson
      ? {
          id: item.responsiblePerson.id,
          name: `${item.responsiblePerson.firstName} ${item.responsiblePerson.lastName}`,
        }
      : null,
  };
}
