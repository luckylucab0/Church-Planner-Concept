import { Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { CreateEventDto, SetSlotsDto, UpdateEventDto } from './dto/scheduling.dto';
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

  // Mitglieder sehen nur veröffentlichte Termine; Admins und Teamleiter
  // auch Entwürfe (PLANNED), weil sie darauf planen.
  private async visibleStatuses(user: AuthUser): Promise<EventStatus[]> {
    if (this.permissions.isAdmin(user)) return ['PLANNED', 'PUBLISHED', 'CANCELLED'];
    const ledTeams = await this.permissions.getLedTeamIds(user.personId);
    return ledTeams.length > 0 ? ['PLANNED', 'PUBLISHED', 'CANCELLED'] : ['PUBLISHED'];
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
        },
      },
    });
    if (!event) throw new NotFoundException();

    const ledTeamIds = this.permissions.isAdmin(user)
      ? event.slots.map((s) => s.position.team.id)
      : await this.permissions.getLedTeamIds(user.personId);

    return {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      status: event.status,
      slots: event.slots.map((slot) => ({
        id: slot.id,
        requiredCount: slot.requiredCount,
        position: {
          id: slot.position.id,
          name: slot.position.name,
          team: slot.position.team,
        },
        // canAssign steuert nur die UI – die Assignments-API prüft selbst
        canAssign: ledTeamIds.includes(slot.position.team.id),
        assignments: slot.assignments.map((assignment) => ({
          id: assignment.id,
          personId: assignment.person.id,
          personName: `${assignment.person.firstName} ${assignment.person.lastName}`,
          status: assignment.status,
          declineReason: assignment.declineReason,
        })),
      })),
    };
  }

  async create(user: AuthUser, dto: CreateEventDto) {
    // Slots optional aus dem Template des Typs übernehmen
    const template = dto.serviceTypeId
      ? await this.prisma.serviceTypePosition.findMany({
          where: { serviceTypeId: dto.serviceTypeId },
        })
      : [];
    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
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
    await this.ensureExists(eventId);
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
  async setSlots(eventId: string, dto: SetSlotsDto) {
    await this.ensureExists(eventId);
    const existing = await this.prisma.eventPositionSlot.findMany({ where: { eventId } });
    const wantedByPosition = new Map(dto.items.map((item) => [item.positionId, item]));

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
    return this.prisma.eventPositionSlot.findMany({
      where: { eventId },
      include: { position: true },
    });
  }

  private async ensureExists(eventId: string): Promise<void> {
    const exists = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException();
  }
}
