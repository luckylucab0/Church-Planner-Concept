import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { downloadJson } from '../../lib/download';
import { useSession } from '../auth/SessionContext';

type TeamRole = 'LEADER' | 'DEPUTY' | 'MEMBER' | 'INTERN';
type NoteKind = 'GENERAL' | 'PASTORAL';

interface PersonNote {
  id: string;
  kind: NoteKind;
  content: string;
  authorName: string | null;
  createdAt: string;
}

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
  globalRole?: 'ADMIN' | 'MEMBER'; // ebenfalls nur für Admins, nur mit Konto
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
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const isAdmin = session?.globalRole === 'ADMIN';

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [manageableTeams, setManageableTeams] = useState<TeamSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Notizen: null = keine Leseberechtigung (die API antwortet mit 403,
  // die Sektion bleibt dann komplett ausgeblendet)
  const [notes, setNotes] = useState<PersonNote[] | null>(null);
  const [noteKind, setNoteKind] = useState<NoteKind>('GENERAL');
  const [noteContent, setNoteContent] = useState('');

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

  const loadNotes = useCallback(() => {
    if (!id) return;
    void api
      .get<PersonNote[]>(`/people/${id}/notes`)
      .then(setNotes)
      .catch(() => setNotes(null));
  }, [id]);

  useEffect(loadNotes, [loadNotes]);

  function transientNotice(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  }

  // --- Notizen ---------------------------------------------------

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!id || !noteContent.trim()) return;
    await api.post(`/people/${id}/notes`, { kind: noteKind, content: noteContent.trim() });
    setNoteContent('');
    loadNotes();
  }

  async function deleteNote(noteId: string) {
    if (!window.confirm(t('notes.deleteConfirm'))) return;
    await api.delete(`/people/notes/${noteId}`);
    loadNotes();
  }

  // --- DSGVO-Aktionen (nur Admin) --------------------------------

  async function exportPersonData() {
    if (!id || !person) return;
    const data = await api.get<unknown>(`/people/${id}/export`);
    downloadJson(data, `serveflow-${person.lastName}-${person.firstName}.json`.toLowerCase());
  }

  // Anonymisieren behält die Planhistorie (wer wann Dienst hatte),
  // Löschen entfernt alles – deshalb zwei getrennte Aktionen.
  async function anonymizePerson() {
    if (!id || !person) return;
    const name = `${person.firstName} ${person.lastName}`;
    if (!window.confirm(t('gdpr.anonymizeConfirm', { name }))) return;
    await api.post(`/people/${id}/anonymize`);
    await reload();
    transientNotice(t('gdpr.anonymized'));
  }

  async function deletePerson() {
    if (!id || !person) return;
    const name = `${person.firstName} ${person.lastName}`;
    if (!window.confirm(t('gdpr.deleteConfirm', { name }))) return;
    await api.delete(`/people/${id}`);
    navigate('/people');
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

  // Globale Rolle. Der Wechsel meldet die Person serverseitig ab, deshalb
  // die ausdrückliche Rückfrage – sie muss sich danach neu anmelden.
  async function changeGlobalRole(role: 'ADMIN' | 'MEMBER') {
    if (!id || !person || role === person.globalRole) return;
    const name = `${person.firstName} ${person.lastName}`;
    const question =
      role === 'ADMIN'
        ? t('people.makeAdminConfirm', { name })
        : t('people.revokeAdminConfirm', { name });
    if (!window.confirm(question)) return;
    await api.patch(`/people/${id}/role`, { globalRole: role });
    await reload();
    transientNotice(t('people.roleChanged'));
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
        {/* Auf dem Handy umbrechen: Name und Admin-Aktionen nebeneinander
            lassen für beide zu wenig Platz. */}
        <div className="flex flex-wrap items-start gap-4">
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
            <div className="flex w-full shrink-0 flex-wrap gap-x-4 gap-y-2 text-sm sm:w-auto sm:flex-col sm:items-end">
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

      {/* Globale Rolle – nur für Admins und nur bei Personen mit Login.
          Die eigene Rolle fehlt bewusst: sie lässt sich serverseitig nicht
          ändern, damit sich niemand selbst aussperrt. */}
      {isAdmin && person.globalRole && person.id !== session?.personId && (
        <section className="card p-4">
          <h2 className="font-medium text-paper">{t('people.globalRoleTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('people.globalRoleHint')}</p>
          <label className="mt-3 block max-w-xs">
            <span className="text-xs text-faint">{t('people.globalRoleLabel')}</span>
            <select
              value={person.globalRole}
              onChange={(e) => void changeGlobalRole(e.target.value as 'ADMIN' | 'MEMBER')}
              className="input mt-1.5"
            >
              <option value="MEMBER">{t('people.globalRoleMember')}</option>
              <option value="ADMIN">{t('people.globalRoleAdmin')}</option>
            </select>
          </label>
        </section>
      )}

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
                    <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
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

      {/* Notizen – verschlüsselt gespeichert. GENERAL sehen Admins und
          Teamleitende der Person, PASTORAL ausschließlich Admins. */}
      {notes !== null && (
        <section className="card p-4">
          <h2 className="font-medium text-paper">{t('notes.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('notes.hint')}</p>

          {notes.length === 0 ? (
            <p className="mt-2 text-sm text-faint">{t('notes.empty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {notes.map((note) => (
                <li key={note.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                    <span
                      className={`badge ${note.kind === 'PASTORAL' ? 'badge-danger' : 'badge-muted'}`}
                    >
                      {t(`notes.kind.${note.kind}`)}
                    </span>
                    <span>
                      {new Date(note.createdAt).toLocaleDateString(i18n.language)}
                      {note.authorName ? ` · ${note.authorName}` : ''}
                    </span>
                    <button
                      onClick={() => void deleteNote(note.id)}
                      className="ml-auto hover:text-paper"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{note.content}</p>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void addNote(e)} className="mt-3 space-y-2">
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              maxLength={5000}
              rows={3}
              placeholder={t('notes.placeholder')}
              aria-label={t('notes.add')}
              className="input"
            />
            <div className="flex flex-wrap items-center gap-2">
              {/* PASTORAL nur anbieten, wenn die eigene Rolle es auch lesen
                  darf – sonst schriebe man sich Notizen, die man nie sieht */}
              {isAdmin && (
                <select
                  value={noteKind}
                  onChange={(e) => setNoteKind(e.target.value as NoteKind)}
                  aria-label={t('notes.kindLabel')}
                  className="input w-auto text-sm"
                >
                  <option value="GENERAL">{t('notes.kind.GENERAL')}</option>
                  <option value="PASTORAL">{t('notes.kind.PASTORAL')}</option>
                </select>
              )}
              <button type="submit" disabled={!noteContent.trim()} className="btn-primary text-sm">
                {t('notes.add')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* DSGVO-Aktionen: Export, Anonymisieren, Löschen. Die eigene Person
          fehlt bewusst – wer sich selbst löscht, sperrt sich aus. */}
      {isAdmin && person.id !== session?.personId && (
        <section className="card p-4">
          <h2 className="font-medium text-paper">{t('gdpr.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('gdpr.hint')}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button onClick={() => void exportPersonData()} className="btn-ghost text-sm">
              {t('gdpr.export')}
            </button>
            {person.status !== 'ANONYMIZED' && (
              <button onClick={() => void anonymizePerson()} className="btn-ghost text-sm">
                {t('gdpr.anonymize')}
              </button>
            )}
            <button
              onClick={() => void deletePerson()}
              className="btn-ghost text-sm text-danger hover:text-paper"
            >
              {t('gdpr.delete')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
