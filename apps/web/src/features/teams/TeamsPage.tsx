import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useSession } from '../auth/SessionContext';

type TeamRole = 'LEADER' | 'DEPUTY' | 'MEMBER' | 'INTERN';
type SkillLevel = 'BEGINNER' | 'SOLID' | 'EXPERT';

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
  color?: string;
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

const SKILL_LEVELS: SkillLevel[] = ['BEGINNER', 'SOLID', 'EXPERT'];
const DEFAULT_TEAM_COLOR = '#c9a55c';

// Teams-Übersicht mit aufklappbarem Detail. Die API liefert nur, was die
// Rolle sehen darf (die can*-Flags steuern lediglich, welche Aktionen die
// UI anbietet – durchgesetzt wird serverseitig).
export default function TeamsPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const isAdmin = session?.globalRole === 'ADMIN';

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [openTeam, setOpenTeam] = useState<TeamDetail | null>(null);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [matrixSaved, setMatrixSaved] = useState(false);
  const [allPeople, setAllPeople] = useState<{ id: string; name: string }[]>([]);
  const [addPersonId, setAddPersonId] = useState('');
  const [addRole, setAddRole] = useState<TeamRole>('MEMBER');

  // Team anlegen/umbenennen (nur Admin)
  const [teamForm, setTeamForm] = useState<{ name: string; color: string } | null>(null);
  const [renaming, setRenaming] = useState(false);

  // Positionen & Skills
  const [newPosition, setNewPosition] = useState('');
  const [skillFor, setSkillFor] = useState<string | null>(null);
  const [skillPersonId, setSkillPersonId] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('SOLID');

  const loadTeams = useCallback(() => api.get<TeamSummary[]>('/teams').then(setTeams), []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const openDetail = useCallback((teamId: string) => {
    setMatrix(null);
    setMatrixSaved(false);
    setAddPersonId('');
    setAddRole('MEMBER');
    setRenaming(false);
    setNewPosition('');
    setSkillFor(null);
    void api.get<TeamDetail>(`/teams/${teamId}`).then((team) => {
      setOpenTeam(team);
      if (team.canEditMatrix) {
        void api.get<PermissionMatrix>(`/teams/${teamId}/permissions`).then(setMatrix);
      }
    });
  }, []);

  // Personenliste fürs Hinzufügen und für Skill-Zuordnungen – erst laden,
  // wenn ein Team mit entsprechenden Rechten offen ist (die API liefert
  // Nicht-Admins nur Namen)
  useEffect(() => {
    const needsPeople = openTeam?.canManageMembers || openTeam?.canManagePositions;
    if (!needsPeople || allPeople.length > 0) return;
    void api
      .get<{ id: string; firstName: string; lastName: string }[]>('/people')
      .then((people) =>
        setAllPeople(people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))),
      );
  }, [openTeam, allPeople.length]);

  // --- Team anlegen / umbenennen / löschen (Admin) ---------------

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    if (!teamForm) return;
    if (renaming && openTeam) {
      await api.patch(`/teams/${openTeam.id}`, { name: teamForm.name, color: teamForm.color });
      setRenaming(false);
      setTeamForm(null);
      await loadTeams();
      openDetail(openTeam.id);
      return;
    }
    const created = await api.post<{ id: string }>('/teams', {
      name: teamForm.name,
      color: teamForm.color,
    });
    setTeamForm(null);
    await loadTeams();
    openDetail(created.id);
  }

  async function deleteTeam() {
    if (!openTeam || !window.confirm(t('teams.deleteConfirm', { name: openTeam.name }))) return;
    await api.delete(`/teams/${openTeam.id}`);
    setOpenTeam(null);
    await loadTeams();
  }

  // --- Positionen & Skills --------------------------------------

  async function addPosition(event: FormEvent) {
    event.preventDefault();
    if (!openTeam || !newPosition.trim()) return;
    await api.post(`/teams/${openTeam.id}/positions`, { name: newPosition.trim() });
    setNewPosition('');
    await loadTeams();
    openDetail(openTeam.id);
  }

  async function deletePosition(positionId: string, name: string) {
    if (!openTeam || !window.confirm(t('teams.deletePositionConfirm', { name }))) return;
    await api.delete(`/positions/${positionId}`);
    await loadTeams();
    openDetail(openTeam.id);
  }

  async function setSkill(positionId: string) {
    if (!openTeam || !skillPersonId) return;
    await api.put(`/positions/${positionId}/skills/${skillPersonId}`, { skillLevel });
    setSkillPersonId('');
    openDetail(openTeam.id);
  }

  async function removeSkill(positionId: string, personId: string) {
    if (!openTeam) return;
    await api.delete(`/positions/${positionId}/skills/${personId}`);
    openDetail(openTeam.id);
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.teams')}</h1>
        {isAdmin && !teamForm && (
          <button
            onClick={() => {
              setRenaming(false);
              setTeamForm({ name: '', color: DEFAULT_TEAM_COLOR });
            }}
            className="btn-primary"
          >
            + {t('teams.create')}
          </button>
        )}
      </div>

      {teamForm && (
        <section className="card p-4">
          <h2 className="mb-3 font-semibold text-paper">
            {renaming ? t('teams.edit') : t('teams.create')}
          </h2>
          <form onSubmit={(e) => void saveTeam(e)} className="flex flex-wrap items-end gap-3">
            <label className="min-w-[12rem] flex-1">
              <span className="text-sm text-secondary">{t('teams.teamName')}</span>
              <input
                required
                maxLength={100}
                value={teamForm.name}
                onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                className="input mt-1.5"
              />
            </label>
            <label>
              <span className="text-sm text-secondary">{t('teams.color')}</span>
              <input
                type="color"
                value={teamForm.color}
                onChange={(e) => setTeamForm({ ...teamForm, color: e.target.value })}
                className="input mt-1.5 h-[38px] w-16 p-1"
              />
            </label>
            <button type="submit" className="btn-primary">
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setTeamForm(null)} className="text-sm text-muted">
              {t('common.cancel')}
            </button>
          </form>
        </section>
      )}

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-paper">{openTeam.name}</h2>
            <div className="flex items-center gap-4 text-sm">
              {isAdmin && (
                <>
                  <button
                    onClick={() => {
                      setRenaming(true);
                      setTeamForm({
                        name: openTeam.name,
                        color: openTeam.color ?? DEFAULT_TEAM_COLOR,
                      });
                      window.scrollTo(0, 0);
                    }}
                    className="text-faint hover:text-paper"
                  >
                    {t('common.edit')}
                  </button>
                  <button onClick={() => void deleteTeam()} className="text-faint hover:text-paper">
                    {t('common.delete')}
                  </button>
                </>
              )}
              <button
                onClick={() => setOpenTeam(null)}
                aria-label={t('common.cancel')}
                className="text-faint"
              >
                ✕
              </button>
            </div>
          </div>

          <h3 className="mt-3 text-sm font-medium text-secondary">{t('teams.members')}</h3>
          <ul className="mt-1 divide-y divide-line">
            {openTeam.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="min-w-0">
                  {member.firstName} {member.lastName}
                  {ROLE_BADGE[member.role] && (
                    <span className={`ml-1 ${ROLE_BADGE[member.role]}`}>
                      {t(`teams.roles.${member.role}`)}
                    </span>
                  )}
                </span>
                {/* min-w-0 + wrap: lange E-Mails dürfen die Karte auf dem
                    Handy nicht sprengen – Aktionen brechen in die nächste
                    Zeile um, Kontaktdaten werden gekürzt */}
                <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                  {(member.email || member.phone) && (
                    <span className="max-w-[180px] truncate text-muted sm:max-w-xs">
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
                className="input w-auto max-w-full min-w-0 px-2 py-1 text-xs"
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
          <ul className="mt-1 space-y-2">
            {openTeam.positions.map((position) => (
              <li key={position.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{position.name}</span>
                  {openTeam.canManagePositions && (
                    <span className="ml-auto flex items-center gap-3">
                      <button
                        onClick={() => {
                          setSkillFor(skillFor === position.id ? null : position.id);
                          setSkillPersonId('');
                        }}
                        className="text-xs link-gold"
                      >
                        {t('teams.assignPeople')}
                      </button>
                      <button
                        onClick={() => void deletePosition(position.id, position.name)}
                        className="text-xs text-faint hover:text-paper"
                      >
                        {t('common.delete')}
                      </button>
                    </span>
                  )}
                </div>

                {/* Wer kann diese Position – mit Skill-Level. Die
                    Vorschlags-Engine warnt, wenn jemand ohne Zuordnung
                    eingeteilt werden soll. */}
                {position.people.length === 0 ? (
                  <p className="text-muted">—</p>
                ) : (
                  <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                    {position.people.map((person) => (
                      <li key={person.personId} className="flex items-center gap-1 text-muted">
                        <span>{person.name}</span>
                        <span className="badge badge-muted">
                          {t(`teams.skills.${person.skillLevel}`)}
                        </span>
                        {openTeam.canManagePositions && (
                          <button
                            onClick={() => void removeSkill(position.id, person.personId)}
                            aria-label={t('teams.removeSkill')}
                            className="text-faint hover:text-paper"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {skillFor === position.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink p-2">
                    <select
                      value={skillPersonId}
                      onChange={(e) => setSkillPersonId(e.target.value)}
                      aria-label={t('teams.selectPerson')}
                      className="input w-auto max-w-full min-w-0 px-2 py-1 text-xs"
                    >
                      <option value="">{t('teams.selectPerson')}</option>
                      {allPeople
                        .filter((person) => !position.people.some((p) => p.personId === person.id))
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={skillLevel}
                      onChange={(e) => setSkillLevel(e.target.value as SkillLevel)}
                      aria-label={t('teams.skillLevel')}
                      className="input w-auto px-2 py-1 text-xs"
                    >
                      {SKILL_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t(`teams.skills.${level}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void setSkill(position.id)}
                      disabled={!skillPersonId}
                      className="btn-primary px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {t('teams.assignPeople')}
                    </button>
                  </div>
                )}
              </li>
            ))}
            {openTeam.positions.length === 0 && (
              <li className="text-sm text-faint">{t('teams.noPositions')}</li>
            )}
          </ul>

          {openTeam.canManagePositions && (
            <form onSubmit={(e) => void addPosition(e)} className="mt-2 flex flex-wrap gap-2">
              <input
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                maxLength={100}
                placeholder={t('teams.positionNamePlaceholder')}
                aria-label={t('teams.addPosition')}
                className="input w-auto max-w-full min-w-0 flex-1 px-2 py-1 text-xs sm:flex-none sm:basis-56"
              />
              <button
                type="submit"
                disabled={!newPosition.trim()}
                className="btn-ghost px-2 py-1 text-xs disabled:opacity-50"
              >
                + {t('teams.addPosition')}
              </button>
            </form>
          )}

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
