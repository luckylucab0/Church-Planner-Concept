import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreatePersonDto, UpdateMeDto, UpdatePersonDto, UpdatePrivacyDto } from './dto/people.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { buildPersonView, PersonView } from '../authz/person-visibility';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // Liste: jede Person wird durch den Field-Visibility-Layer gefiltert –
  // ein Mitglied bekommt hier grundsätzlich nur Name+Foto pro Eintrag.
  async list(user: AuthUser, search?: string): Promise<PersonView[]> {
    const where: Prisma.PersonWhereInput = {
      // Anonymisierte/archivierte Personen sieht nur der Admin
      ...(this.permissions.isAdmin(user) ? {} : { status: 'ACTIVE' as const }),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const persons = await this.prisma.person.findMany({
      where,
      include: { privacySettings: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const relationships = await this.permissions.relationshipsTo(
      user,
      persons.map((p) => p.id),
    );
    return persons.map((person) => buildPersonView(person, relationships.get(person.id)!));
  }

  async get(user: AuthUser, personId: string): Promise<PersonView> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: { privacySettings: true },
    });
    if (!person) throw new NotFoundException();

    const relationship = await this.permissions.relationshipTo(user, personId);
    if (!this.permissions.isAdmin(user) && person.status !== 'ACTIVE' && !relationship.isSelf) {
      throw new NotFoundException();
    }

    // Wer Kontaktdaten einer ANDEREN Person einsehen kann, wird
    // protokolliert (Nachvollziehbarkeit von Datenzugriffen)
    if (
      !relationship.isSelf &&
      (relationship.viewerRole === 'ADMIN' || relationship.isLeaderOfTarget)
    ) {
      this.audit.log({
        actorId: user.personId,
        action: 'VIEW',
        entityType: 'Person',
        entityId: personId,
      });
    }
    return buildPersonView(person, relationship);
  }

  async create(user: AuthUser, dto: CreatePersonDto): Promise<PersonView> {
    const person = await this.prisma.person.create({
      data: {
        ...dto,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        privacySettings: { create: {} }, // Defaults: nichts freigegeben
      },
      include: { privacySettings: true },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Person',
      entityId: person.id,
    });
    return buildPersonView(person, await this.permissions.relationshipTo(user, person.id));
  }

  async update(user: AuthUser, personId: string, dto: UpdatePersonDto): Promise<PersonView> {
    await this.ensureExists(personId);
    const person = await this.prisma.person.update({
      where: { id: personId },
      data: { ...dto, birthday: dto.birthday ? new Date(dto.birthday) : undefined },
      include: { privacySettings: true },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Person',
      entityId: personId,
      changedFields: Object.keys(dto),
    });
    return buildPersonView(person, await this.permissions.relationshipTo(user, personId));
  }

  // Vollständige Löschung (Recht auf Vergessen): Kaskaden entfernen alle
  // abhängigen Daten inkl. Einteilungen. Wo Planhistorie erhalten bleiben
  // soll, ist anonymize() der richtige Weg.
  async delete(user: AuthUser, personId: string): Promise<void> {
    if (personId === user.personId) {
      throw new ForbiddenException('Eigenes Konto kann nicht gelöscht werden');
    }
    await this.ensureExists(personId);
    await this.prisma.person.delete({ where: { id: personId } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'Person',
      entityId: personId,
    });
  }

  // Anonymisierung: personenbezogene Daten unwiederbringlich entfernen,
  // aber Assignment-Zeilen behalten, damit historische Pläne vollständig
  // bleiben ("N.N." statt Lücke).
  async anonymize(user: AuthUser, personId: string): Promise<void> {
    if (personId === user.personId) {
      throw new ForbiddenException('Eigenes Konto kann nicht anonymisiert werden');
    }
    await this.ensureExists(personId);
    await this.prisma.$transaction([
      this.prisma.userAccount.deleteMany({ where: { personId } }),
      this.prisma.privacySettings.deleteMany({ where: { personId } }),
      this.prisma.note.deleteMany({ where: { personId } }),
      this.prisma.authToken.deleteMany({ where: { personId } }),
      this.prisma.calendarFeedToken.deleteMany({ where: { personId } }),
      this.prisma.absence.deleteMany({ where: { personId } }),
      this.prisma.recurringUnavailability.deleteMany({ where: { personId } }),
      this.prisma.positionSkill.deleteMany({ where: { personId } }),
      this.prisma.teamMembership.deleteMany({ where: { personId } }),
      this.prisma.person.update({
        where: { id: personId },
        data: {
          firstName: 'Ehemaliges',
          lastName: 'Mitglied',
          email: null,
          phone: null,
          birthday: null,
          address: null,
          photoUrl: null,
          importNotes: null,
          status: 'ANONYMIZED',
          anonymizedAt: new Date(),
        },
      }),
    ]);
    this.audit.log({
      actorId: user.personId,
      action: 'ANONYMIZE',
      entityType: 'Person',
      entityId: personId,
    });
  }

  // Datenexport (Art. 15/20 DSGVO): alle gespeicherten Daten einer Person
  // als strukturiertes JSON. Notizen sind bewusst NICHT enthalten – sie
  // sind Daten über die Person aus Sicht Dritter mit eigener
  // Berechtigungsstufe und werden auf Anfrage separat geprüft.
  async exportData(user: AuthUser, personId: string): Promise<Record<string, unknown>> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: {
        privacySettings: true,
        memberships: { include: { team: { select: { name: true } } } },
        positionSkills: {
          include: { position: { select: { name: true, team: { select: { name: true } } } } },
        },
        absences: true,
        recurringUnavailabilities: true,
        assignments: {
          include: {
            slot: {
              include: {
                event: { select: { title: true, startsAt: true } },
                position: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!person) throw new NotFoundException();

    this.audit.log({
      actorId: user.personId,
      action: 'EXPORT',
      entityType: 'Person',
      entityId: personId,
    });

    return {
      exportedAt: new Date().toISOString(),
      person: {
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        phone: person.phone,
        birthday: person.birthday,
        address: person.address,
        locale: person.locale,
        status: person.status,
        createdAt: person.createdAt,
      },
      privacySettings: person.privacySettings,
      teams: person.memberships.map((m) => ({ team: m.team.name, isLeader: m.isLeader })),
      positions: person.positionSkills.map((s) => ({
        team: s.position.team.name,
        position: s.position.name,
        skillLevel: s.skillLevel,
      })),
      absences: person.absences.map((a) => ({
        from: a.fromDate,
        to: a.toDate,
        reason: a.reason,
      })),
      recurringUnavailabilities: person.recurringUnavailabilities.map((r) => ({
        rrule: r.rrule,
        note: r.note,
      })),
      assignments: person.assignments.map((a) => ({
        event: a.slot.event.title,
        date: a.slot.event.startsAt,
        position: a.slot.position.name,
        status: a.status,
      })),
    };
  }

  // --- Eigenes Profil ----------------------------------------

  async updateMe(user: AuthUser, dto: UpdateMeDto): Promise<PersonView> {
    const person = await this.prisma.person.update({
      where: { id: user.personId },
      data: { ...dto, birthday: dto.birthday ? new Date(dto.birthday) : undefined },
      include: { privacySettings: true },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Person',
      entityId: user.personId,
      changedFields: Object.keys(dto),
    });
    return buildPersonView(person, await this.permissions.relationshipTo(user, user.personId));
  }

  async getPrivacy(user: AuthUser) {
    return this.prisma.privacySettings.upsert({
      where: { personId: user.personId },
      create: { personId: user.personId },
      update: {},
    });
  }

  async updatePrivacy(user: AuthUser, dto: UpdatePrivacyDto) {
    return this.prisma.privacySettings.upsert({
      where: { personId: user.personId },
      create: { personId: user.personId, ...dto },
      update: dto,
    });
  }

  private async ensureExists(personId: string): Promise<void> {
    const exists = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException();
  }
}
