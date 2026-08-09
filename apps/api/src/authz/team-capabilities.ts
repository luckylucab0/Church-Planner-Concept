import { TeamCapability, TeamRole } from '@prisma/client';

// Default-Rechtematrix pro Rolle. Gilt, solange ein Team für eine
// Rolle/Capability keine eigene TeamRolePermission-Zeile gespeichert hat
// (lazy defaults – neue Capabilities brauchen so keine Datenmigration).
//
// LEADER taucht hier bewusst NICHT auf: die Rolle hat implizit alle
// Rechte und ist nicht konfigurierbar, damit sich ein Team nie selbst
// aussperren kann.
//
// DEPUTY = "Leiter ohne Personalhoheit": plant und teilt ein, verwaltet
// aber keine Mitgliedschaften/Rollen. MEMBER/INTERN starten ohne
// Verwaltungsrechte; Teams schalten gezielt frei.
//
// MANAGE_EVENTS ist die eine Ausnahme von der DEPUTY-Regel und startet für
// ALLE konfigurierbaren Rollen aus: einen Gottesdienst anzulegen oder
// abzusagen ist ein gemeindeweiter Akt, kein teaminterner, und das Recht
// wirkt über hasCapabilityInAnyTeam auf alle Termine. Bestehende
// Installationen ändern sich durch das Update damit nicht.
export const TEAM_CAPABILITIES: TeamCapability[] = [
  'ASSIGN',
  'OPEN_SIGNUP',
  'SELF_SIGNUP',
  'MANAGE_MEMBERS',
  'MANAGE_POSITIONS',
  'NOTES',
  'VIEW_CONTACTS',
  'VIEW_DRAFTS',
  'EDIT_PLAN',
  'MANAGE_SONGS',
  'MANAGE_EVENTS',
];

export type ConfigurableTeamRole = Exclude<TeamRole, 'LEADER'>;

export const CONFIGURABLE_ROLES: ConfigurableTeamRole[] = ['DEPUTY', 'MEMBER', 'INTERN'];

export const DEFAULT_MATRIX: Record<ConfigurableTeamRole, Record<TeamCapability, boolean>> = {
  DEPUTY: {
    ASSIGN: true,
    OPEN_SIGNUP: true,
    SELF_SIGNUP: true,
    MANAGE_MEMBERS: false,
    MANAGE_POSITIONS: true,
    NOTES: true,
    VIEW_CONTACTS: true,
    VIEW_DRAFTS: true,
    EDIT_PLAN: true,
    MANAGE_SONGS: true,
    MANAGE_EVENTS: false,
  },
  MEMBER: {
    ASSIGN: false,
    OPEN_SIGNUP: false,
    // Selbst-Eintragung ist der Zweck der Slot-Freigabe – standardmäßig
    // dürfen alle Rollen; Teams schalten gezielt ab
    SELF_SIGNUP: true,
    MANAGE_MEMBERS: false,
    MANAGE_POSITIONS: false,
    NOTES: false,
    VIEW_CONTACTS: false,
    VIEW_DRAFTS: false,
    EDIT_PLAN: false,
    MANAGE_SONGS: false,
    MANAGE_EVENTS: false,
  },
  INTERN: {
    ASSIGN: false,
    OPEN_SIGNUP: false,
    SELF_SIGNUP: true,
    MANAGE_MEMBERS: false,
    MANAGE_POSITIONS: false,
    NOTES: false,
    VIEW_CONTACTS: false,
    VIEW_DRAFTS: false,
    EDIT_PLAN: false,
    MANAGE_SONGS: false,
    MANAGE_EVENTS: false,
  },
};

export function defaultAllowed(role: TeamRole, capability: TeamCapability): boolean {
  if (role === 'LEADER') return true;
  return DEFAULT_MATRIX[role][capability];
}
