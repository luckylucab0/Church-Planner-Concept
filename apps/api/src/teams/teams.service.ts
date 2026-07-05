import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SkillLevel } from '@prisma/client';
import { AddMemberDto, CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { buildPersonView } from '../authz/person-visibility';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // Admin oder Leiter GENAU DIESES Teams – die zentrale Scope-Prüfung
  // für alle verwaltenden Team-Operationen
  private async ensureCanManage(user: AuthUser, teamId: string): Promise<void> {
    if (this.permissions.isAdmin(user)) return;
    const ledTeams = await this.permissions.getLedTeamIds(user.personId);
    if (!ledTeams.includes(teamId)) {
      throw new ForbiddenException('Nur Admins oder Leiter dieses Teams');
    }
  }

  async list(user: AuthUser) {
    const teams = await this.prisma.team.findMany({
      include: {
        positions: { orderBy: { name: 'asc' } },
        _count: { select: { memberships: true } },
      },
      orderBy: { name: 'asc' },
    });
    const ledTeamIds = this.permissions.isAdmin(user)
      ? teams.map((t) => t.id)
      : await this.permissions.getLedTeamIds(user.personId);
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      memberCount: team._count.memberships,
      positions: team.positions.map((p) => ({ id: p.id, name: p.name })),
      canManage: ledTeamIds.includes(team.id),
    }));
  }

  async get(user: AuthUser, teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        positions: {
          orderBy: { name: 'asc' },
          include: {
            skills: {
              include: { person: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        },
        memberships: {
          include: { person: { include: { privacySettings: true } } },
          orderBy: { person: { lastName: 'asc' } },
        },
      },
    });
    if (!team) throw new NotFoundException();

    // Mitgliederliste läuft durch den Field-Visibility-Layer – auch hier
    // gibt es keine Kontaktdaten "durch die Hintertür"
    const relationships = await this.permissions.relationshipsTo(
      user,
      team.memberships.map((m) => m.personId),
    );
    const ledTeamIds = this.permissions.isAdmin(user)
      ? [teamId]
      : await this.permissions.getLedTeamIds(user.personId);

    return {
      id: team.id,
      name: team.name,
      color: team.color,
      canManage: ledTeamIds.includes(teamId),
      members: team.memberships.map((membership) => ({
        ...buildPersonView(membership.person, relationships.get(membership.personId)!),
        isLeader: membership.isLeader,
      })),
      positions: team.positions.map((position) => ({
        id: position.id,
        name: position.name,
        people: position.skills.map((skill) => ({
          personId: skill.person.id,
          name: `${skill.person.firstName} ${skill.person.lastName}`,
          skillLevel: skill.skillLevel,
        })),
      })),
    };
  }

  async create(user: AuthUser, dto: CreateTeamDto) {
    const team = await this.prisma.team.create({ data: dto });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Team',
      entityId: team.id,
    });
    return team;
  }

  async update(user: AuthUser, teamId: string, dto: UpdateTeamDto) {
    await this.ensureTeamExists(teamId);
    const team = await this.prisma.team.update({ where: { id: teamId }, data: dto });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Team',
      entityId: teamId,
      changedFields: Object.keys(dto),
    });
    return team;
  }

  async delete(user: AuthUser, teamId: string): Promise<void> {
    await this.ensureTeamExists(teamId);
    await this.prisma.team.delete({ where: { id: teamId } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'Team',
      entityId: teamId,
    });
  }

  // --- Mitglieder --------------------------------------------

  async addMember(user: AuthUser, teamId: string, dto: AddMemberDto) {
    await this.ensureTeamExists(teamId);
    await this.ensureCanManage(user, teamId);
    // Leiter dürfen Mitglieder verwalten, aber das Leader-Flag ist
    // Admin-Sache: verhindert, dass ein kompromittiertes Leiter-Konto
    // beliebig weitere Leiter-Zugänge erzeugt
    if (dto.isLeader && !this.permissions.isAdmin(user)) {
      throw new ForbiddenException('Teamleiter-Flag kann nur ein Admin setzen');
    }
    return this.prisma.teamMembership.upsert({
      where: { teamId_personId: { teamId, personId: dto.personId } },
      create: { teamId, personId: dto.personId, isLeader: dto.isLeader ?? false },
      update: this.permissions.isAdmin(user) ? { isLeader: dto.isLeader ?? false } : {},
    });
  }

  async removeMember(user: AuthUser, teamId: string, personId: string): Promise<void> {
    await this.ensureCanManage(user, teamId);
    await this.prisma.teamMembership.deleteMany({ where: { teamId, personId } });
    // Skills für Positionen dieses Teams mit entfernen – wer nicht mehr
    // im Team ist, soll nicht mehr als einteilbar gelten
    await this.prisma.positionSkill.deleteMany({
      where: { personId, position: { teamId } },
    });
  }

  // --- Positionen --------------------------------------------

  async createPosition(user: AuthUser, teamId: string, name: string) {
    await this.ensureTeamExists(teamId);
    await this.ensureCanManage(user, teamId);
    return this.prisma.position.create({ data: { teamId, name } });
  }

  async deletePosition(user: AuthUser, positionId: string): Promise<void> {
    const position = await this.findPosition(positionId);
    await this.ensureCanManage(user, position.teamId);
    await this.prisma.position.delete({ where: { id: positionId } });
  }

  // --- Skills -------------------------------------------------

  async setSkill(user: AuthUser, positionId: string, personId: string, skillLevel: SkillLevel) {
    const position = await this.findPosition(positionId);
    await this.ensureCanManage(user, position.teamId);
    // Nur Team-Mitglieder können einer Position zugeordnet werden
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_personId: { teamId: position.teamId, personId } },
    });
    if (!membership) {
      throw new ForbiddenException('Person ist kein Mitglied dieses Teams');
    }
    return this.prisma.positionSkill.upsert({
      where: { positionId_personId: { positionId, personId } },
      create: { positionId, personId, skillLevel },
      update: { skillLevel },
    });
  }

  async removeSkill(user: AuthUser, positionId: string, personId: string): Promise<void> {
    const position = await this.findPosition(positionId);
    await this.ensureCanManage(user, position.teamId);
    await this.prisma.positionSkill.deleteMany({ where: { positionId, personId } });
  }

  private async ensureTeamExists(teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new NotFoundException();
  }

  private async findPosition(positionId: string) {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });
    if (!position) throw new NotFoundException();
    return position;
  }
}
