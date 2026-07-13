import { Injectable } from '@nestjs/common';
import { TeamCapability, TeamRole } from '@prisma/client';
import { defaultAllowed } from './team-capabilities';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { ViewerRelationship } from './person-visibility';

// Zentrale Rechte-Auflösung: globale Rolle (ADMIN), Teamrolle
// (LEADER implizit alles) und die konfigurierbare Rechtematrix pro Team
// (TeamRolePermission, fehlende Zeile = Default aus team-capabilities.ts).
// Für Listen bewusst Batch-Varianten, sonst würden N+1-Queries anfallen.
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  isAdmin(user: AuthUser): boolean {
    return user.globalRole === 'ADMIN';
  }

  // Darf der Nutzer die Capability in GENAU DIESEM Team ausüben?
  async hasCapability(user: AuthUser, teamId: string, capability: TeamCapability): Promise<boolean> {
    if (this.isAdmin(user)) return true;
    const teamIds = await this.getTeamIdsWithCapability(user, capability);
    return teamIds.includes(teamId);
  }

  // Alle Teams, in denen der Nutzer die Capability hat – Grundlage für
  // Scope-Prüfungen (z. B. canAssign pro Slot). Konstant viele Queries.
  async getTeamIdsWithCapability(user: AuthUser, capability: TeamCapability): Promise<string[]> {
    const memberships = await this.prisma.teamMembership.findMany({
      where: { personId: user.personId },
      select: { teamId: true, role: true },
    });
    if (memberships.length === 0) return [];

    // Matrix-Zeilen nur für Nicht-LEADER-Rollen nötig
    const nonLeader = memberships.filter((m) => m.role !== 'LEADER');
    const overrides = nonLeader.length
      ? await this.prisma.teamRolePermission.findMany({
          where: { teamId: { in: nonLeader.map((m) => m.teamId) }, capability },
          select: { teamId: true, role: true, allowed: true },
        })
      : [];
    const overrideKey = (teamId: string, role: TeamRole) => `${teamId}:${role}`;
    const overrideMap = new Map(overrides.map((o) => [overrideKey(o.teamId, o.role), o.allowed]));

    return memberships
      .filter((m) => {
        if (m.role === 'LEADER') return true;
        return overrideMap.get(overrideKey(m.teamId, m.role)) ?? defaultAllowed(m.role, capability);
      })
      .map((m) => m.teamId);
  }

  // Capability in irgendeinem Team? Für teamübergreifende Ressourcen
  // (Liederdatenbank, Ablaufplan, Entwurfs-Sichtbarkeit) – der Ablauf
  // eines Gottesdienstes entsteht teamübergreifend.
  async hasCapabilityInAnyTeam(user: AuthUser, capability: TeamCapability): Promise<boolean> {
    if (this.isAdmin(user)) return true;
    const teamIds = await this.getTeamIdsWithCapability(user, capability);
    return teamIds.length > 0;
  }

  // Teams, die der Nutzer als LEADER leitet (z. B. für Benachrichtigungen
  // und die Matrix-Verwaltung – NICHT für delegierbare Rechte verwenden).
  async getLeaderTeamIds(personId: string): Promise<string[]> {
    const memberships = await this.prisma.teamMembership.findMany({
      where: { personId, role: 'LEADER' },
      select: { teamId: true },
    });
    return memberships.map((m) => m.teamId);
  }

  async getTeamIds(personId: string): Promise<string[]> {
    const memberships = await this.prisma.teamMembership.findMany({
      where: { personId },
      select: { teamId: true },
    });
    return memberships.map((m) => m.teamId);
  }

  async relationshipTo(user: AuthUser, targetPersonId: string): Promise<ViewerRelationship> {
    const map = await this.relationshipsTo(user, [targetPersonId]);
    return map.get(targetPersonId)!;
  }

  // Batch: eine Handvoll Queries für beliebig viele Zielpersonen
  async relationshipsTo(
    user: AuthUser,
    targetPersonIds: string[],
  ): Promise<Map<string, ViewerRelationship>> {
    const result = new Map<string, ViewerRelationship>();
    const viewerIsAdmin = this.isAdmin(user);

    const [viewerTeamIds, contactTeamIds, notesTeamIds] = viewerIsAdmin
      ? [[], [], []]
      : [
          await this.getTeamIds(user.personId),
          await this.getTeamIdsWithCapability(user, 'VIEW_CONTACTS'),
          await this.getTeamIdsWithCapability(user, 'NOTES'),
        ];

    // Alle Team-Mitgliedschaften der Zielpersonen in einem Rutsch
    const targetMemberships = viewerIsAdmin
      ? []
      : await this.prisma.teamMembership.findMany({
          where: { personId: { in: targetPersonIds } },
          select: { personId: true, teamId: true },
        });
    const teamsByPerson = new Map<string, string[]>();
    for (const membership of targetMemberships) {
      const list = teamsByPerson.get(membership.personId) ?? [];
      list.push(membership.teamId);
      teamsByPerson.set(membership.personId, list);
    }

    for (const targetId of targetPersonIds) {
      const targetTeams = teamsByPerson.get(targetId) ?? [];
      result.set(targetId, {
        viewerRole: user.globalRole,
        isSelf: targetId === user.personId,
        canViewContactsOfTarget: targetTeams.some((teamId) => contactTeamIds.includes(teamId)),
        canNotesOnTarget: targetTeams.some((teamId) => notesTeamIds.includes(teamId)),
        sharesTeamWithTarget: targetTeams.some((teamId) => viewerTeamIds.includes(teamId)),
      });
    }
    return result;
  }
}
