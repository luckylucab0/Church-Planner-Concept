import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useSession } from '../auth/SessionContext';

type TeamRole = 'LEADER' | 'DEPUTY' | 'MEMBER' | 'INTERN';

// Die API liefert nur die Felder, die die eigene Rolle sehen darf –
// unsichtbare Felder FEHLEN komplett (kein null), die UI rendert, was da ist.
interface PersonDetail {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  address?: string | null;
  createdAt?: string;
  hasAccount?: boolean; // nur für Admins gesetzt
  memberships: { teamId: string; teamName: string; color: string; role: TeamRole }[];
}

interface TeamSummary {
  id: string;
  name: string;
  canManageMembers: boolean;
}

const ROLE_BADGE: Record<TeamRole, string> = {
  LEADER: 'badge badge-gold',
  DEPUTY: 'badge badge-success',
  INTERN: 'badge badge-muted',
  MEMBER: 'badge badge-muted',
};

const TEAM_ROLES: TeamRole[] = ['LEADER', 'DEPUTY', 'MEMBER', 'INTERN'];

// Detailseite einer Person (/people/:id): zeigt genau die Felder, die die
// API für die eigene Rolle liefert. Admins bearbeiten die Stammdaten;
// Admins und Teamleiter (für ihre Teams) verwalten die Team-Zugehörigkeit.
export default function PersonDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const isAdmin = session?.globalRole === 'ADMIN';

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [manageableTeams, setManageableTeams] = useState<TeamSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Admin-Bearbeitung der Stammdaten
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthday: '',
    address: '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Team hinzufügen
  const [addTeamId, setAddTeamId] = useState('');
  const [addRole, setAddRole] = useState<TeamRole>('MEMBER');

  const reload = useCallback(() => {
    if (!id) return Promise.resolve();
    return api
      .get<PersonDetail>(`/people/${id}`)
      .then(setPerson)
      .catch(() => setNotFound(true));
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    // Nur laden, wenn Team-Aktionen überhaupt in Frage kommen
    if (!isAdmin && (session?.ledTeamIds.length ?? 0) === 0) return;
    void api
      .get<TeamSummary[]>('/teams')
      .then((teams) => setManageableTeams(teams.filter((team) => team.canManageMembers)))
      .catch(console.error);
  }, [isAdmin, session]);

  function transientNotice(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  }

  function startEdit() {
    if (!person) return;
    setEditForm({
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email ?? '',
      phone: person.phone ?? '',
      birthday: person.birthday ? person.birthday.slice(0, 10) : '',
      address: person.address ?? '',
    });
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setEditError(null);
    setSaving(true);
    try {
      await api.patch(`/people/${id}`, {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        ...(editForm.email ? { email: editForm.email } : {}),
        ...(editForm.phone ? { phone: editForm.phone } : {}),
        ...(editForm.birthday ? { birthday: editForm.birthday } : {}),
        ...(editForm.address ? { address: editForm.address } : {}),
      });
      setEditing(false);
      await reload();
      transientNotice(t('people.saved'));
    } catch (error) {
      setEditError(
        error instanceof ApiError && error.status === 409
          ? t('people.emailTaken')
          : t('common.error'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite() {
    if (!id) return;
    await api.post(`/auth/invite/for/${id}`);
    transientNotice(t('people.inviteSent'));
  }

  async function sendReset() {
    if (!id) return;
    await api.post(`/auth/password-reset/for/${id}`);
    transientNotice(t('people.resetSent'));
  }

  // --- Team-Zugehörigkeit ---------------------------------------

  const canManageTeam = useCallback(
    (teamId: string) => manageableTeams.some((team) => team.id === teamId),
    [manageableTeams],
  );

  async function changeTeamRole(teamId: string, role: TeamRole) {
    if (!id) return;
    await api.patch(`/teams/${teamId}/members/${id}`, { role });
    await reload();
  }

  async function removeFromTeam(teamId: string, teamName: string) {
    if (!id || !window.confirm(t('people.removeFromTeamConfirm', { team: teamName }))) return;
    await api.delete(`/teams/${teamId}/members/${id}`);
    await reload();
  }

  async function addToTeam(event: FormEvent) {
    event.preventDefault();
    if (!id || !addTeamId) return;
    await api.post(`/teams/${addTeamId}/members`, { personId: id, role: addRole });
    setAddTeamId('');
    setAddRole('MEMBER');
    await reload();
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link to="/people" className="text-sm link-gold">
          ← {t('people.backToList')}
        </Link>
        <p className="text-muted">{t('people.notFound')}</p>
      </div>
    );
  }
  if (!person) return <p className="text-muted">{t('common.loading')}</p>;

  const addableTeams = manageableTeams.filter(
    (team) => !person.memberships.some((m) => m.teamId === team.id),
  );

  const infoRows: { label: string; value: string | null | undefined }[] = [
    { label: t('people.email'), value: person.email },
    { label: t('people.phone'), value: person.phone },
    {
      label: t('people.birthday'),
      value: person.birthday ? new Date(person.birthday).toLocaleDateString('de-CH') : undefined,
    },
    { label: t('people.address'), value: person.address },
  ];
  const visibleRows = infoRows.filter((row) => row.value);

  return (
    <div className="space-y-4">
      <Link to="/people" className="text-sm link-gold">
        ← {t('people.backToList')}
      </Link>

      <section className="card p-4">
        <div className="flex items-start gap-4">
          {person.photoUrl ? (
            <img src={person.photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-avatar text-xl font-medium text-secondary">
              {person.firstName[0]}
              {person.lastName[0]}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-bold tracking-tight text-paper">
              {person.firstName} {person.lastName}
            </h1>
            {person.status !== 'ACTIVE' && (
              <span className="badge badge-muted">{person.status}</span>
            )}
            {notice && <p className="text-sm text-success">{notice}</p>}
          </div>
          {isAdmin && !editing && (
            <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
              <button onClick={startEdit} className="link-gold">
                {t('common.edit')}
              </button>
              {person.email && person.hasAccount === false && (
                <button onClick={() => void sendInvite()} className="text-faint hover:text-paper">
                  {t('people.invite')}
                </button>
              )}
              {person.email && person.hasAccount && (
                <button onClick={() => void sendReset()} className="text-faint hover:text-paper">
                  {t('people.sendReset')}
                </button>
              )}
            </div>
          )}
        </div>

        {!editing ? (
          visibleRows.length > 0 && (
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {visibleRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-faint">{row.label}</dt>
                  <dd className="text-paper">{row.value}</dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          <form onSubmit={(e) => void saveEdit(e)} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm text-secondary">{t('people.firstName')}</span>
                <input
                  required
                  maxLength={100}
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('people.lastName')}</span>
                <input
                  required
                  maxLength={100}
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('people.email')}</span>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('people.phone')}</span>
                <input
                  maxLength={50}
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('people.birthday')}</span>
                <input
                  type="date"
                  value={editForm.birthday}
                  onChange={(e) => setEditForm({ ...editForm, birthday: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('people.address')}</span>
                <input
                  maxLength={300}
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
            </div>
            {editError && <p className="text-sm text-red-400">{editError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary">
                {t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-sm text-muted"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Teams der Person – Verwaltung für Admins und Leiter ihrer Teams */}
      <section className="card p-4">
        <h2 className="font-medium text-paper">{t('people.teamsTitle')}</h2>
        {person.memberships.length === 0 ? (
          <p className="mt-2 text-sm text-faint">{t('people.noTeams')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {person.memberships.map((membership) => {
              const manageable = canManageTeam(membership.teamId);
              // LEADER-Zeilen ändern/entfernen kann nur ein Admin
              const leaderLocked = membership.role === 'LEADER' && !isAdmin;
              return (
                <li
                  key={membership.teamId}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: membership.color }}
                  />
                  <span className="font-medium text-paper">{membership.teamName}</span>
                  <span className={ROLE_BADGE[membership.role]}>
                    {t(`teams.roles.${membership.role}`)}
                  </span>
                  {manageable && (
                    <span className="ml-auto flex items-center gap-2">
                      <select
                        value={membership.role}
                        onChange={(e) =>
                          void changeTeamRole(membership.teamId, e.target.value as TeamRole)
                        }
                        disabled={leaderLocked}
                        aria-label={t('teams.changeRole')}
                        className="input w-auto px-2 py-1 text-xs"
                      >
                        {TEAM_ROLES.map((role) => (
                          <option key={role} value={role} disabled={role === 'LEADER' && !isAdmin}>
                            {t(`teams.roles.${role}`)}
                          </option>
                        ))}
                      </select>
                      {!leaderLocked && (
                        <button
                          onClick={() =>
                            void removeFromTeam(membership.teamId, membership.teamName)
                          }
                          className="text-xs text-faint hover:text-paper"
                        >
                          {t('people.removeFromTeam')}
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {addableTeams.length > 0 && (
          <form onSubmit={(e) => void addToTeam(e)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-xs text-faint">{t('people.addToTeam')}</span>
              <select
                value={addTeamId}
                onChange={(e) => setAddTeamId(e.target.value)}
                className="input mt-1 w-auto text-sm"
                required
              >
                <option value="">{t('teams.selectTeam')}</option>
                {addableTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as TeamRole)}
              aria-label={t('teams.changeRole')}
              className="input w-auto text-sm"
            >
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role} disabled={role === 'LEADER' && !isAdmin}>
                  {t(`teams.roles.${role}`)}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!addTeamId} className="btn-primary">
              {t('people.addToTeamSubmit')}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
