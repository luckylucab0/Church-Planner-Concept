import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

type TeamRole = 'LEADER' | 'DEPUTY' | 'MEMBER' | 'INTERN';

interface TeamSummary {
  id: string;
  name: string;
  color: string;
  memberCount: number;
  positions: { id: string; name: string }[];
  canManage: boolean;
}

interface TeamDetail {
  id: string;
  name: string;
  canManage: boolean;
  canManageMembers: boolean;
  canManagePositions: boolean;
  canEditMatrix: boolean;
  canGrantLeader: boolean;
  members: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    role: TeamRole;
  }[];
  positions: {
    id: string;
    name: string;
    people: { personId: string; name: string; skillLevel: string }[];
  }[];
}

interface PermissionMatrix {
  capabilities: string[];
  roles: string[];
  entries: Record<string, Record<string, boolean>>;
}

const ROLE_BADGE: Record<TeamRole, string | null> = {
  LEADER: 'badge badge-gold',
  DEPUTY: 'badge badge-success',
  INTERN: 'badge badge-muted',
  MEMBER: null, // Standardrolle braucht keinen Badge
};

// Teams-Übersicht mit aufklappbarem Detail. Die API liefert nur, was die
// Rolle sehen darf (die can*-Flags steuern lediglich, welche Aktionen die
// UI anbietet – durchgesetzt wird serverseitig).
export default function TeamsPage() {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [openTeam, setOpenTeam] = useState<TeamDetail | null>(null);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [matrixSaved, setMatrixSaved] = useState(false);
  const [allPeople, setAllPeople] = useState<{ id: string; name: string }[]>([]);
  const [addPersonId, setAddPersonId] = useState('');
  const [addRole, setAddRole] = useState<TeamRole>('MEMBER');

  useEffect(() => {
    void api.get<TeamSummary[]>('/teams').then(setTeams);
  }, []);

  const openDetail = useCallback((teamId: string) => {
    setMatrix(null);
    setMatrixSaved(false);
    setAddPersonId('');
    setAddRole('MEMBER');
    void api.get<TeamDetail>(`/teams/${teamId}`).then((team) => {
      setOpenTeam(team);
      if (team.canEditMatrix) {
        void api.get<PermissionMatrix>(`/teams/${teamId}/permissions`).then(setMatrix);
      }
    });
  }, []);

  // Personenliste fürs Hinzufügen – erst laden, wenn jemand ein Team mit
  // Mitgliederrechten geöffnet hat (die API liefert Nicht-Admins nur Namen)
  useEffect(() => {
    if (!openTeam?.canManageMembers || allPeople.length > 0) return;
    void api
      .get<{ id: string; firstName: string; lastName: string }[]>('/people')
      .then((people) =>
        setAllPeople(people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))),
      );
  }, [openTeam, allPeople.length]);

  async function changeRole(personId: string, role: TeamRole) {
    if (!openTeam) return;
    await api.patch(`/teams/${openTeam.id}/members/${personId}`, { role });
    openDetail(openTeam.id);
  }

  async function addMember() {
    if (!openTeam || !addPersonId) return;
    await api.post(`/teams/${openTeam.id}/members`, { personId: addPersonId, role: addRole });
    openDetail(openTeam.id);
  }

  async function removeMember(personId: string, name: string) {
    if (!openTeam || !window.confirm(t('teams.removeConfirm', { name }))) return;
    await api.delete(`/teams/${openTeam.id}/members/${personId}`);
    openDetail(openTeam.id);
  }

  // Ein Matrix-Häkchen umschalten und sofort speichern – die API upsertet
  // pro (Rolle, Capability) und liefert die gemergte Sicht zurück.
  async function toggleCapability(role: string, capability: string) {
    if (!openTeam || !matrix) return;
    const allowed = !matrix.entries[role][capability];
    setMatrix({
      ...matrix,
      entries: { ...matrix.entries, [role]: { ...matrix.entries[role], [capability]: allowed } },
    });
    const updated = await api.put<PermissionMatrix>(`/teams/${openTeam.id}/permissions`, {
      entries: [{ role, capability, allowed }],
    });
    setMatrix(updated);
    setMatrixSaved(true);
    setTimeout(() => setMatrixSaved(false), 2000);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.teams')}</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        {teams.map((team) => (
          <button key={team.id} onClick={() => openDetail(team.id)} className="card p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color }} />
              <span className="font-semibold text-paper">{team.name}</span>
              <span className="ml-auto text-sm text-muted">{team.memberCount} 👤</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {team.positions.map((p) => p.name).join(' · ') || '—'}
            </p>
          </button>
        ))}
      </div>

      {openTeam && (
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-paper">{openTeam.name}</h2>
            <button onClick={() => setOpenTeam(null)} className="text-sm text-faint">
              ✕
            </button>
          </div>

          <h3 className="mt-3 text-sm font-medium text-secondary">{t('teams.members')}</h3>
          <ul className="mt-1 divide-y divide-line">
            {openTeam.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span>
                  {member.firstName} {member.lastName}
                  {ROLE_BADGE[member.role] && (
                    <span className={`ml-1 ${ROLE_BADGE[member.role]}`}>
                      {t(`teams.roles.${member.role}`)}
                    </span>
                  )}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {(member.email || member.phone) && (
                    <span className="truncate text-muted">
                      {[member.email, member.phone].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {openTeam.canManageMembers && (
                    <select
                      value={member.role}
                      onChange={(e) => void changeRole(member.id, e.target.value as TeamRole)}
                      // Rolle LEADER vergeben/ändern kann nur ein Admin
                      disabled={member.role === 'LEADER' && !openTeam.canGrantLeader}
                      aria-label={t('teams.changeRole')}
                      className="input w-auto px-2 py-1 text-xs"
                    >
                      {(['LEADER', 'DEPUTY', 'MEMBER', 'INTERN'] as TeamRole[]).map((role) => (
                        <option
                          key={role}
                          value={role}
                          disabled={role === 'LEADER' && !openTeam.canGrantLeader}
                        >
                          {t(`teams.roles.${role}`)}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Leitung entfernen kann nur ein Admin */}
                  {openTeam.canManageMembers &&
                    (member.role !== 'LEADER' || openTeam.canGrantLeader) && (
                      <button
                        onClick={() =>
                          void removeMember(member.id, `${member.firstName} ${member.lastName}`)
                        }
                        className="text-xs text-faint hover:text-paper"
                      >
                        {t('teams.removeMember')}
                      </button>
                    )}
                </span>
              </li>
            ))}
          </ul>

          {openTeam.canManageMembers && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={addPersonId}
                onChange={(e) => setAddPersonId(e.target.value)}
                aria-label={t('teams.addMember')}
                className="input w-auto px-2 py-1 text-xs"
              >
                <option value="">{t('teams.selectPerson')}</option>
                {allPeople
                  .filter((person) => !openTeam.members.some((m) => m.id === person.id))
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as TeamRole)}
                aria-label={t('teams.changeRole')}
                className="input w-auto px-2 py-1 text-xs"
              >
                {(['LEADER', 'DEPUTY', 'MEMBER', 'INTERN'] as TeamRole[]).map((role) => (
                  <option
                    key={role}
                    value={role}
                    disabled={role === 'LEADER' && !openTeam.canGrantLeader}
                  >
                    {t(`teams.roles.${role}`)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void addMember()}
                disabled={!addPersonId}
                className="btn-primary px-2 py-1 text-xs disabled:opacity-50"
              >
                + {t('teams.addMember')}
              </button>
            </div>
          )}

          <h3 className="mt-3 text-sm font-medium text-secondary">{t('teams.positions')}</h3>
          <ul className="mt-1 space-y-1">
            {openTeam.positions.map((position) => (
              <li key={position.id} className="text-sm">
                <span className="font-medium">{position.name}:</span>{' '}
                <span className="text-muted">
                  {position.people.map((p) => p.name).join(', ') || '—'}
                </span>
              </li>
            ))}
          </ul>

          {matrix && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-secondary">
                  {t('teams.permissionsTitle')}
                </h3>
                {matrixSaved && (
                  <span className="text-xs text-success">{t('teams.permissionsSaved')}</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-faint">{t('teams.permissionsHint')}</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1.5 pr-2 font-normal" />
                      {matrix.roles.map((role) => (
                        <th key={role} className="px-2 py-1.5 text-center font-medium">
                          {t(`teams.roles.${role}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {matrix.capabilities.map((capability) => (
                      <tr key={capability}>
                        <td className="py-1.5 pr-2 text-secondary">
                          {t(`teams.capabilities.${capability}`)}
                        </td>
                        {matrix.roles.map((role) => (
                          <td key={role} className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={matrix.entries[role]?.[capability] ?? false}
                              onChange={() => void toggleCapability(role, capability)}
                              aria-label={`${t(`teams.roles.${role}`)} – ${t(`teams.capabilities.${capability}`)}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
