import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { ViewerRelationship } from './person-visibility';

// Berechnet die Beziehung Betrachter↔Zielperson(en) für den
// Field-Visibility-Layer. Für Listen bewusst als Batch-Variante,
// sonst würden N+1-Queries pro Personenliste anfallen.
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  isAdmin(user: AuthUser): boolean {
    return user.globalRole === 'ADMIN';
  }

  // Teams, die der Nutzer leitet
  async getLedTeamIds(personId: string): Promise<string[]> {
    const memberships = await this.prisma.teamMembership.findMany({
      where: { personId, isLeader: true },
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

    const [viewerTeamIds, viewerLedTeamIds] = viewerIsAdmin
      ? [[], []]
      : [await this.getTeamIds(user.personId), await this.getLedTeamIds(user.personId)];

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
        isLeaderOfTarget: targetTeams.some((teamId) => viewerLedTeamIds.includes(teamId)),
        sharesTeamWithTarget: targetTeams.some((teamId) => viewerTeamIds.includes(teamId)),
      });
    }
    return result;
  }
}
