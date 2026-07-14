import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import { useSession } from '../auth/SessionContext';

// Die API liefert nur die Felder, die die eigene Rolle sehen darf –
// die UI rendert schlicht, was da ist (kein clientseitiges "Ausblenden").
interface PersonEntry {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  hasAccount?: boolean; // nur für Admins gesetzt
}

interface UserRequestEntry {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  teamId: string;
  teamName: string;
  requestedByName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewComment?: string | null;
}

interface TeamEntry {
  id: string;
  name: string;
}

interface PersonFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: PersonFormValues = { firstName: '', lastName: '', email: '', phone: '' };

const STATUS_BADGE: Record<UserRequestEntry['status'], string> = {
  PENDING: 'badge badge-muted',
  APPROVED: 'badge badge-success',
  REJECTED: 'badge badge-danger',
};

// Gemeinsame Feldgruppe für "Person anlegen" (Admin) und
// "Benutzer beantragen" (Leiter) – identische Datenbasis.
function PersonFields({
  form,
  onChange,
}: {
  form: PersonFormValues;
  onChange: (patch: Partial<PersonFormValues>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="text-sm text-secondary">{t('people.firstName')}</span>
        <input
          required
          maxLength={100}
          value={form.firstName}
          onChange={(e) => onChange({ firstName: e.target.value })}
          className="input mt-1.5"
        />
      </label>
      <label className="block">
        <span className="text-sm text-secondary">{t('people.lastName')}</span>
        <input
          required
          maxLength={100}
          value={form.lastName}
          onChange={(e) => onChange({ lastName: e.target.value })}
          className="input mt-1.5"
        />
      </label>
      <label className="block">
        <span className="text-sm text-secondary">{t('people.email')}</span>
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          className="input mt-1.5"
        />
      </label>
      <label className="block">
        <span className="text-sm text-secondary">
          {t('people.phone')} ({t('common.optional')})
        </span>
        <input
          maxLength={50}
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          className="input mt-1.5"
        />
      </label>
    </div>
  );
}

export default function PeopleListPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const isAdmin = session?.globalRole === 'ADMIN';
  const isLeader = !isAdmin && (session?.ledTeamIds.length ?? 0) > 0;

  const [people, setPeople] = useState<PersonEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [rowNotice, setRowNotice] = useState<{ id: string; text: string } | null>(null);

  // Admin: Person anlegen & einladen
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Benutzer-Anträge (Admin: offene prüfen, Leiter: eigene stellen/sehen)
  const [requests, setRequests] = useState<UserRequestEntry[]>([]);
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(EMPTY_FORM);
  const [requestTeamId, setRequestTeamId] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [ledTeams, setLedTeams] = useState<TeamEntry[]>([]);

  const loadPeople = useCallback((query: string) => {
    return api
      .get<PersonEntry[]>(`/people${query ? `?search=${encodeURIComponent(query)}` : ''}`)
      .then(setPeople)
      .catch(console.error);
  }, []);

  const loadRequests = useCallback(() => {
    if (!isAdmin && !isLeader) return Promise.resolve();
    const url = isAdmin ? '/user-requests?status=PENDING' : '/user-requests';
    return api.get<UserRequestEntry[]>(url).then(setRequests).catch(console.error);
  }, [isAdmin, isLeader]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      void loadPeople(search).finally(() => setLoading(false));
    }, 200); // debounce für die Suche
    return () => clearTimeout(timeout);
  }, [search, loadPeople]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!isLeader || !session) return;
    api
      .get<TeamEntry[]>('/teams')
      .then((teams) => setLedTeams(teams.filter((team) => session.ledTeamIds.includes(team.id))))
      .catch(console.error);
  }, [isLeader, session]);

  function notice(id: string, text: string) {
    setRowNotice({ id, text });
    setTimeout(() => setRowNotice(null), 3000);
  }

  // Admin-Hilfe bei Aussperrung: stößt die Passwort-Reset-Mail an
  async function sendReset(personId: string) {
    await api.post(`/auth/password-reset/for/${personId}`);
    notice(personId, t('people.resetSent'));
  }

  // Einladung (erneut) senden – für Personen ohne Konto
  async function sendInvite(personId: string) {
    await api.post(`/auth/invite/for/${personId}`);
    notice(personId, t('people.inviteSent'));
  }

  async function createAndInvite(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const person = await api.post<PersonEntry>('/people', {
        firstName: createForm.firstName,
        lastName: createForm.lastName,
        email: createForm.email,
        ...(createForm.phone ? { phone: createForm.phone } : {}),
      });
      await api.post(`/auth/invite/for/${person.id}`);
      setCreateForm(EMPTY_FORM);
      setCreateOpen(false);
      await loadPeople(search);
      notice(person.id, t('people.inviteSent'));
    } catch (error) {
      setCreateError(
        error instanceof ApiError && error.status === 409
          ? t('people.emailTaken')
          : t('common.error'),
      );
    } finally {
      setCreating(false);
    }
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    setRequestError(null);
    setRequesting(true);
    try {
      await api.post('/user-requests', {
        firstName: requestForm.firstName,
        lastName: requestForm.lastName,
        email: requestForm.email,
        ...(requestForm.phone ? { phone: requestForm.phone } : {}),
        teamId: requestTeamId || ledTeams[0]?.id,
      });
      setRequestForm(EMPTY_FORM);
      setRequestOpen(false);
      await loadRequests();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const message = (error.body as { message?: string } | null)?.message;
        setRequestError(
          message === 'userRequests.alreadyPending'
            ? t('userRequests.alreadyPending')
            : t('userRequests.emailExists'),
        );
      } else {
        setRequestError(t('common.error'));
      }
    } finally {
      setRequesting(false);
    }
  }

  async function review(requestId: string, action: 'approve' | 'reject') {
    await api.post(`/user-requests/${requestId}/${action}`, {
      ...(reviewComments[requestId]?.trim() ? { comment: reviewComments[requestId].trim() } : {}),
    });
    await Promise.all([loadRequests(), loadPeople(search)]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.people')}</h1>
        <input
          type="search"
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input text-sm"
        />
      </div>

      {/* Admin: neue Person erfassen und direkt einladen */}
      {isAdmin && (
        <section className="card p-4">
          <button
            onClick={() => setCreateOpen((open) => !open)}
            className="flex w-full items-center justify-between text-left font-medium text-paper"
          >
            {t('people.addAndInvite')}
            <span className="text-faint">{createOpen ? '−' : '+'}</span>
          </button>
          {createOpen && (
            <form onSubmit={(e) => void createAndInvite(e)} className="mt-4 space-y-4">
              <PersonFields
                form={createForm}
                onChange={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))}
              />
              {createError && <p className="text-sm text-red-400">{createError}</p>}
              <button type="submit" disabled={creating} className="btn-primary">
                {t('people.addAndInviteSubmit')}
              </button>
            </form>
          )}
        </section>
      )}

      {/* Admin: offene Benutzer-Anträge prüfen */}
      {isAdmin && requests.length > 0 && (
        <section className="card space-y-3 p-4">
          <h2 className="font-medium text-paper">{t('userRequests.pendingTitle')}</h2>
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="space-y-2 py-3">
                <p className="text-sm text-paper">
                  <span className="font-medium">
                    {request.firstName} {request.lastName}
                  </span>{' '}
                  · {request.email}
                  {request.phone ? ` · ${request.phone}` : ''}
                </p>
                <p className="text-xs text-muted">
                  {t('userRequests.team')}: {request.teamName} · {t('userRequests.requestedBy')}:{' '}
                  {request.requestedByName}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    placeholder={t('userRequests.commentPlaceholder')}
                    value={reviewComments[request.id] ?? ''}
                    onChange={(e) =>
                      setReviewComments((prev) => ({ ...prev, [request.id]: e.target.value }))
                    }
                    className="input min-w-40 flex-1 text-sm"
                    maxLength={500}
                  />
                  <button
                    onClick={() => void review(request.id, 'approve')}
                    className="btn-primary"
                  >
                    {t('userRequests.approve')}
                  </button>
                  <button onClick={() => void review(request.id, 'reject')} className="btn-ghost">
                    {t('userRequests.reject')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Teamleiter: Benutzer beantragen + eigene Anträge */}
      {isLeader && (
        <section className="card p-4">
          <button
            onClick={() => setRequestOpen((open) => !open)}
            className="flex w-full items-center justify-between text-left font-medium text-paper"
          >
            {t('userRequests.request')}
            <span className="text-faint">{requestOpen ? '−' : '+'}</span>
          </button>
          {requestOpen && (
            <form onSubmit={(e) => void submitRequest(e)} className="mt-4 space-y-4">
              <PersonFields
                form={requestForm}
                onChange={(patch) => setRequestForm((prev) => ({ ...prev, ...patch }))}
              />
              {ledTeams.length > 1 && (
                <label className="block">
                  <span className="text-sm text-secondary">{t('userRequests.team')}</span>
                  <select
                    value={requestTeamId || ledTeams[0]?.id || ''}
                    onChange={(e) => setRequestTeamId(e.target.value)}
                    className="input mt-1.5"
                  >
                    {ledTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-xs text-faint">{t('userRequests.hint')}</p>
              {requestError && <p className="text-sm text-red-400">{requestError}</p>}
              <button type="submit" disabled={requesting} className="btn-primary">
                {t('userRequests.submit')}
              </button>
            </form>
          )}
          {requests.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-medium text-secondary">{t('userRequests.myRequests')}</h3>
              <ul className="divide-y divide-line">
                {requests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-paper">
                        {request.firstName} {request.lastName} · {request.teamName}
                      </p>
                      {request.reviewComment && (
                        <p className="truncate text-xs text-muted">
                          {t('userRequests.comment')}: {request.reviewComment}
                        </p>
                      )}
                    </div>
                    <span className={STATUS_BADGE[request.status]}>
                      {t(`userRequests.status${request.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 p-3">
              {person.photoUrl ? (
                <img src={person.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-avatar font-medium text-secondary">
                  {person.firstName[0]}
                  {person.lastName[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-paper">
                  {person.firstName} {person.lastName}
                </p>
                {(person.email || person.phone) && (
                  <p className="truncate text-sm text-muted">
                    {[person.email, person.phone].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              {isAdmin &&
                person.email &&
                (rowNotice?.id === person.id ? (
                  <span className="shrink-0 text-xs text-success">{rowNotice.text}</span>
                ) : person.hasAccount ? (
                  <button
                    onClick={() => void sendReset(person.id)}
                    className="shrink-0 text-xs text-faint hover:text-paper"
                  >
                    {t('people.sendReset')}
                  </button>
                ) : (
                  <button
                    onClick={() => void sendInvite(person.id)}
                    className="shrink-0 text-xs link-gold"
                  >
                    {t('people.invite')}
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
