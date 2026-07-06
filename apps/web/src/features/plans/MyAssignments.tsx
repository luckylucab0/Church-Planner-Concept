import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';

interface MyAssignment {
  id: string;
  status: 'REQUESTED' | 'ACCEPTED' | 'DECLINED';
  eventTitle: string;
  startsAt: string;
  location?: string | null;
  position: string;
  pendingReplacement: { candidateName: string } | null;
}

interface Candidate {
  personId: string;
  name: string;
}

// "Meine Dienste" auf dem Dashboard: anstehende Einteilungen mit
// direkter Zusage/Absage und Vertretungssuche (eingeloggt, ohne Mail-Link).
export default function MyAssignments() {
  const { t, i18n } = useTranslation();
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api.get<MyAssignment[]>('/me/assignments').then(setAssignments);
  }, []);

  useEffect(reload, [reload]);

  async function respond(id: string, action: 'ACCEPTED' | 'DECLINED') {
    await api.post(`/me/assignments/${id}/respond`, { action });
    reload();
  }

  async function openCandidates(id: string) {
    setError(null);
    setCandidatesFor(id);
    setCandidates(await api.get<Candidate[]>(`/me/assignments/${id}/replacement-candidates`));
  }

  async function askReplacement(id: string, personId: string) {
    setError(null);
    try {
      await api.post(`/me/assignments/${id}/replacement-request`, {
        candidatePersonId: personId,
      });
      setCandidatesFor(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t('assignments.conflictUnavailable'));
      } else {
        setError(t('common.error'));
      }
    }
  }

  async function cancelReplacement(id: string) {
    await api.delete(`/me/assignments/${id}/replacement-request`);
    reload();
  }

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{t('assignments.myAssignments')}</h2>
      {assignments.length === 0 && (
        <p className="text-sm text-gray-500">{t('assignments.noneUpcoming')}</p>
      )}
      <ul className="space-y-2">
        {assignments.map((assignment) => (
          <li key={assignment.id} className="rounded-xl bg-white p-3 shadow">
            <p className="text-sm font-medium">
              {assignment.eventTitle} · {assignment.position}
            </p>
            <p className="text-xs text-gray-500">
              {new Date(assignment.startsAt).toLocaleString(i18n.language, {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {assignment.status !== 'ACCEPTED' && (
                <button
                  onClick={() => void respond(assignment.id, 'ACCEPTED')}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white"
                >
                  ✓ {t('assignments.accept')}
                </button>
              )}
              {assignment.status !== 'DECLINED' && (
                <button
                  onClick={() => void respond(assignment.id, 'DECLINED')}
                  className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600"
                >
                  ✕ {t('assignments.decline')}
                </button>
              )}
              {assignment.status !== 'DECLINED' &&
                !assignment.pendingReplacement &&
                candidatesFor !== assignment.id && (
                  <button
                    onClick={() => void openCandidates(assignment.id)}
                    className="rounded border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-600"
                  >
                    ⇄ {t('replacement.findReplacement')}
                  </button>
                )}
              <span className="ml-auto text-xs text-gray-500">
                {t(`assignments.${assignment.status.toLowerCase()}`)}
              </span>
            </div>

            {assignment.pendingReplacement && (
              <p className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                ⏳{' '}
                {t('replacement.pending', {
                  name: assignment.pendingReplacement.candidateName,
                })}
                <button
                  onClick={() => void cancelReplacement(assignment.id)}
                  className="text-gray-400 underline hover:text-red-600"
                >
                  {t('replacement.cancelRequest')}
                </button>
              </p>
            )}

            {candidatesFor === assignment.id && (
              <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
                <ul className="space-y-1">
                  {candidates.map((candidate) => (
                    <li key={candidate.personId} className="flex items-center gap-2 text-sm">
                      <span>{candidate.name}</span>
                      <button
                        onClick={() => void askReplacement(assignment.id, candidate.personId)}
                        className="ml-auto rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white"
                      >
                        {t('replacement.ask')}
                      </button>
                    </li>
                  ))}
                  {candidates.length === 0 && (
                    <li className="text-xs text-gray-500">{t('replacement.nobodyAvailable')}</li>
                  )}
                </ul>
                <button
                  onClick={() => setCandidatesFor(null)}
                  className="mt-2 text-xs text-gray-500"
                >
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
