import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
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
}

export default function PeopleListPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const isAdmin = session?.globalRole === 'ADMIN';
  const [people, setPeople] = useState<PersonEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [resetSentFor, setResetSentFor] = useState<string | null>(null);

  // Admin-Hilfe bei Aussperrung: stößt die Passwort-Reset-Mail an
  async function sendReset(personId: string) {
    await api.post(`/auth/password-reset/for/${personId}`);
    setResetSentFor(personId);
    setTimeout(() => setResetSentFor(null), 3000);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      api
        .get<PersonEntry[]>(`/people${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        .then(setPeople)
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 200); // debounce für die Suche
    return () => clearTimeout(timeout);
  }, [search]);

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
                (resetSentFor === person.id ? (
                  <span className="shrink-0 text-xs text-success">{t('people.resetSent')}</span>
                ) : (
                  <button
                    onClick={() => void sendReset(person.id)}
                    className="shrink-0 text-xs text-faint hover:text-paper"
                  >
                    {t('people.sendReset')}
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
