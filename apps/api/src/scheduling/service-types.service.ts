import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RRule } from 'rrule';
import { CreateServiceTypeDto, SetTemplateDto, UpdateServiceTypeDto } from './dto/scheduling.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServiceTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.serviceType.findMany({
      include: {
        positionTemplate: {
          include: { position: { include: { team: { select: { name: true, color: true } } } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(user: AuthUser, dto: CreateServiceTypeDto) {
    this.validateRrule(dto.rrule);
    const serviceType = await this.prisma.serviceType.create({ data: dto });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'ServiceType',
      entityId: serviceType.id,
    });
    return serviceType;
  }

  async update(user: AuthUser, id: string, dto: UpdateServiceTypeDto) {
    this.validateRrule(dto.rrule);
    await this.ensureExists(id);
    const serviceType = await this.prisma.serviceType.update({ where: { id }, data: dto });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'ServiceType',
      entityId: id,
      changedFields: Object.keys(dto),
    });
    return serviceType;
  }

  async delete(user: AuthUser, id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.serviceType.delete({ where: { id } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'ServiceType',
      entityId: id,
    });
  }

  // Template komplett ersetzen (idempotent) – einfacher zu bedienen und
  // zu testen als einzelne Add/Remove-Endpunkte
  async setTemplate(id: string, dto: SetTemplateDto) {
    await this.ensureExists(id);
    await this.prisma.$transaction([
      this.prisma.serviceTypePosition.deleteMany({ where: { serviceTypeId: id } }),
      this.prisma.serviceTypePosition.createMany({
        data: dto.items.map((item) => ({
          serviceTypeId: id,
          positionId: item.positionId,
          requiredCount: item.requiredCount,
        })),
      }),
    ]);
    return this.prisma.serviceTypePosition.findMany({ where: { serviceTypeId: id } });
  }

  // Termine aus der RRULE materialisieren: jede Occurrence wird eine
  // Event-Zeile mit Slots aus dem Template. Bereits existierende Termine
  // (gleicher Typ + Startzeit) werden übersprungen – der Endpoint ist
  // dadurch beliebig oft aufrufbar (z. B. monatlicher Admin-Routinelauf).
  async generateEvents(user: AuthUser, id: string, until: Date) {
    const serviceType = await this.prisma.serviceType.findUnique({
      where: { id },
      include: { positionTemplate: true },
    });
    if (!serviceType) throw new NotFoundException();
    if (!serviceType.rrule) {
      throw new BadRequestException('Dieser Gottesdienst-Typ hat keine Wiederholungsregel');
    }
    const horizon = new Date(Date.now() + 366 * 86_400_000);
    if (until > horizon) {
      throw new BadRequestException('Maximal 1 Jahr im Voraus generieren');
    }

    const rule = RRule.fromString(serviceType.rrule);
    const [hour, minute] = (serviceType.startTime ?? '10:00').split(':').map(Number);
    // dtstart = jetzt: Vergangenheit wird nie rückwirkend generiert
    const occurrences = new RRule({
      ...rule.origOptions,
      dtstart: new Date(),
      until,
    }).all();

    const existing = await this.prisma.event.findMany({
      where: { serviceTypeId: id },
      select: { startsAt: true },
    });
    const existingTimes = new Set(existing.map((e) => e.startsAt.getTime()));

    let created = 0;
    for (const occurrence of occurrences) {
      const startsAt = new Date(occurrence);
      startsAt.setHours(hour, minute, 0, 0);
      if (existingTimes.has(startsAt.getTime())) continue;

      await this.prisma.event.create({
        data: {
          serviceTypeId: id,
          title: serviceType.name,
          startsAt,
          endsAt: new Date(startsAt.getTime() + serviceType.durationMinutes * 60_000),
          location: serviceType.location,
          status: 'PUBLISHED',
          slots: {
            create: serviceType.positionTemplate.map((item) => ({
              positionId: item.positionId,
              requiredCount: item.requiredCount,
            })),
          },
        },
      });
      created++;
    }

    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Event',
      changedFields: [`generated:${created}`],
    });
    return { created, skipped: occurrences.length - created };
  }

  private validateRrule(rrule?: string): void {
    if (!rrule) return;
    try {
      RRule.fromString(rrule);
    } catch {
      throw new BadRequestException('Ungültige RRULE (RFC 5545), z. B. FREQ=WEEKLY;BYDAY=SU');
    }
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.serviceType.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException();
  }
}
