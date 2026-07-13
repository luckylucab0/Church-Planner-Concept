import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SkillLevel, TeamCapability, TeamRole } from '@prisma/client';
import { AddMemberDto, CreateTeamDto, SetPermissionsDto, UpdateTeamDto } from './dto/teams.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { CONFIGURABLE_ROLES, DEFAULT_MATRIX, TEAM_CAPABILITIES } from '../authz/team-capabilities';
import { buildPersonView } from '../authz/person-visibility';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // Capability-Scope-Prüfung für verwaltende Team-Operationen:
  // Admin, LEADER (implizit) oder Rolle mit dem Recht laut Matrix
  private async ensureCapability(
    user: AuthUser,
    teamId: string,
    capability: TeamCapability,
  ): Promise<void> {
    if (!(await this.permissions.hasCapability(user, teamId, capability))) {
      throw new ForbiddenException('Dafür fehlt dir in diesem Team die Berechtigung');
    }
  }

  // Die Rechtematrix selbst dürfen nur Admin oder LEADER anfassen –
  // sonst könnte eine Rolle sich eigene Rechte einräumen
  private async ensureLeaderOrAdmin(user: AuthUser, teamId: string): Promise<void> {
    if (this.permissions.isAdmin(user)) return;
    const leaderTeams = await this.permissions.getLeaderTeamIds(user.personId);
    if (!leaderTeams.includes(teamId)) {
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
    const [memberTeamIds, positionTeamIds] = this.permissions.isAdmin(user)
      ? [teams.map((t) => t.id), teams.map((t) => t.id)]
      : [
          await this.permissions.getTeamIdsWithCapability(user, 'MANAGE_MEMBERS'),
          await this.permissions.getTeamIdsWithCapability(user, 'MANAGE_POSITIONS'),
        ];
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      memberCount: team._count.memberships,
      positions: team.positions.map((p) => ({ id: p.id, name: p.name })),
      canManage: memberTeamIds.includes(team.id) || positionTeamIds.includes(team.id),
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
    const isAdmin = this.permissions.isAdmin(user);
    const canManageMembers = await this.permissions.hasCapability(user, teamId, 'MANAGE_MEMBERS');
    const canManagePositions = await this.permissions.hasCapability(
      user,
      teamId,
      'MANAGE_POSITIONS',
    );
    const leaderTeamIds = isAdmin ? [teamId] : await this.permissions.getLeaderTeamIds(user.personId);

    return {
      id: team.id,
      name: team.name,
      color: team.color,
      // UI-Flags – die Endpoints prüfen serverseitig selbst
      canManage: canManageMembers || canManagePositions,
      canManageMembers,
      canManagePositions,
      canEditMatrix: leaderTeamIds.includes(teamId),
      canGrantLeader: isAdmin,
      members: team.memberships.map((membership) => ({
        ...buildPersonView(membership.person, relationships.get(membership.personId)!),
        role: membership.role,
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
    await this.ensureCapability(user, teamId, 'MANAGE_MEMBERS');
    // Mitglieder verwalten ja, aber die Rolle LEADER ist Admin-Sache:
    // verhindert, dass ein kompromittiertes Konto beliebig weitere
    // Leiter-Zugänge erzeugt (Privilegien-Eskalation)
    const role = dto.role ?? 'MEMBER';
    if (role === 'LEADER' && !this.permissions.isAdmin(user)) {
      throw new ForbiddenException('Die Rolle Leiter kann nur ein Admin vergeben');
    }
    const membership = await this.prisma.teamMembership.upsert({
      where: { teamId_personId: { teamId, personId: dto.personId } },
      create: { teamId, personId: dto.personId, role },
      update: dto.role ? { role } : {},
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'TeamMembership',
      entityId: membership.id,
      changedFields: ['role'],
    });
    return membership;
  }

  // Rolle eines bestehenden Mitglieds ändern. LEADER vergeben UND einem
  // LEADER die Rolle entziehen bleibt Admin-only (Demotion-Schutz).
  async setMemberRole(user: AuthUser, teamId: string, personId: string, role: TeamRole) {
    await this.ensureCapability(user, teamId, 'MANAGE_MEMBERS');
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_personId: { teamId, personId } },
    });
    if (!membership) throw new NotFoundException('Person ist kein Mitglied dieses Teams');
    if ((role === 'LEADER' || membership.role === 'LEADER') && !this.permissions.isAdmin(user)) {
      throw new ForbiddenException('Die Rolle Leiter kann nur ein Admin vergeben oder entziehen');
    }
    const updated = await this.prisma.teamMembership.update({
      where: { id: membership.id },
      data: { role },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'TeamMembership',
      entityId: membership.id,
      changedFields: ['role'],
    });
    return { personId, role: updated.role };
  }

  async removeMember(user: AuthUser, teamId: string, personId: string): Promise<void> {
    await this.ensureCapability(user, teamId, 'MANAGE_MEMBERS');
    // Einen LEADER entfernen darf nur ein Admin (Demotion-Schutz)
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_personId: { teamId, personId } },
    });
    if (membership?.role === 'LEADER' && !this.permissions.isAdmin(user)) {
      throw new ForbiddenException('Die Teamleitung kann nur ein Admin entfernen');
    }
    await this.prisma.teamMembership.deleteMany({ where: { teamId, personId } });
    // Skills für Positionen dieses Teams mit entfernen – wer nicht mehr
    // im Team ist, soll nicht mehr als einteilbar gelten
    await this.prisma.positionSkill.deleteMany({
      where: { personId, position: { teamId } },
    });
  }

  // --- Rechtematrix ------------------------------------------

  // Gemergte Sicht: gespeicherte Zeilen überlagern die Code-Defaults,
  // damit die UI immer die volle Matrix zeigt.
  async getPermissionMatrix(user: AuthUser, teamId: string) {
    await this.ensureTeamExists(teamId);
    await this.ensureLeaderOrAdmin(user, teamId);
    const stored = await this.prisma.teamRolePermission.findMany({ where: { teamId } });
    const entries: Record<string, Record<string, boolean>> = {};
    for (const role of CONFIGURABLE_ROLES) {
      entries[role] = { ...DEFAULT_MATRIX[role] };
    }
    for (const row of stored) {
      if (row.role === 'LEADER') continue;
      entries[row.role][row.capability] = row.allowed;
    }
    return { capabilities: TEAM_CAPABILITIES, roles: CONFIGURABLE_ROLES, entries };
  }

  async setPermissionMatrix(user: AuthUser, teamId: string, dto: SetPermissionsDto) {
    await this.ensureTeamExists(teamId);
    await this.ensureLeaderOrAdmin(user, teamId);
    await this.prisma.$transaction(
      dto.entries.map((entry) =>
        this.prisma.teamRolePermission.upsert({
          where: {
            teamId_role_capability: {
              teamId,
              role: entry.role,
              capability: entry.capability,
            },
          },
          create: { teamId, role: entry.role, capability: entry.capability, allowed: entry.allowed },
          update: { allowed: entry.allowed },
        }),
      ),
    );
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Team',
      entityId: teamId,
      changedFields: ['rolePermissions'],
    });
    return this.getPermissionMatrix(user, teamId);
  }

  // --- Positionen --------------------------------------------

  async createPosition(user: AuthUser, teamId: string, name: string) {
    await this.ensureTeamExists(teamId);
    await this.ensureCapability(user, teamId, 'MANAGE_POSITIONS');
    return this.prisma.position.create({ data: { teamId, name } });
  }

  async deletePosition(user: AuthUser, positionId: string): Promise<void> {
    const position = await this.findPosition(positionId);
    await this.ensureCapability(user, position.teamId, 'MANAGE_POSITIONS');
    await this.prisma.position.delete({ where: { id: positionId } });
  }

  // --- Skills -------------------------------------------------

  async setSkill(user: AuthUser, positionId: string, personId: string, skillLevel: SkillLevel) {
    const position = await this.findPosition(positionId);
    await this.ensureCapability(user, position.teamId, 'MANAGE_POSITIONS');
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
    await this.ensureCapability(user, position.teamId, 'MANAGE_POSITIONS');
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
