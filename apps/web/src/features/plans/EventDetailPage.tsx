import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import ServicePlan, { PlanItem } from './ServicePlan';
import { api, ApiError } from '../../api/client';

export interface EventDetail {
  id: string;
  title: string;
  startsAt: string;
  location?: string | null;
  status: string;
  canEditPlan: boolean;
  planItems: PlanItem[];
  slots: EventSlot[];
}

interface EventSlot {
  id: string;
  requiredCount: number;
  openForSignup: boolean;
  position: { id: string; name: string; team: { id: string; name: string; color: string } };
  canAssign: boolean;
  canSignup: boolean;
  assignments: {
    id: string;
    personId: string;
    personName: string;
    status: 'REQUESTED' | 'ACCEPTED' | 'DECLINED';
  }[];
}

interface Suggestion {
  personId: string;
  name: string;
  skillLevel: string;
  daysSinceLastService: number | null;
  assignmentsLast90Days: number;
  warnings: string[];
}

const statusStyle: Record<string, string> = {
  ACCEPTED: 'badge badge-success',
  REQUESTED: 'badge badge-gold',
  DECLINED: 'badge badge-danger',
};

// Dienstplan eines Termins. Teamleiter/Admins (canAssign pro Slot,
// serverseitig bestimmt) können Vorschläge laden und direkt einteilen –
// die Vorschlagsliste erklärt, WARUM jemand oben steht (Fairness).
export default function EventDetailPage() {
  const { t, i18n } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [suggestionsFor, setSuggestionsFor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [signupError, setSignupError] = useState<{ slotId: string; message: string } | null>(null);

  const reload = useCallback(() => {
    if (eventId) void api.get<EventDetail>(`/events/${eventId}`).then(setEvent);
  }, [eventId]);

  useEffect(reload, [reload]);

  async function openSuggestions(slotId: string) {
    setConflict(null);
    setSelectedPersonId('');
    setSuggestionsFor(slotId);
    setSuggestions(await api.get<Suggestion[]>(`/assignments/suggestions?slotId=${slotId}`));
  }

  async function assign(slotId: string, personId: string) {
    setConflict(null);
    try {
      await api.post('/assignments', { slotId, personId });
      setSuggestionsFor(null);
      setSelectedPersonId('');
      reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(t('assignments.conflictUnavailable'));
      }
    }
  }

  // Kompakte Options-Beschriftung: Name + Fairness-Hinweis (warum die
  // Person oben steht) – die Liste selbst bleibt nach Fairness sortiert.
  function suggestionLabel(suggestion: Suggestion) {
    const parts = [
      suggestion.daysSinceLastService === null
        ? t('assignments.neverServed')
        : t('assignments.lastServed', { days: suggestion.daysSinceLastService }),
      t('assignments.recentCount', { count: suggestion.assignmentsLast90Days }),
    ];
    const warn = suggestion.warnings.includes('assignedAdjacentDay')
      ? ` · ⚠ ${t('assignments.warnAdjacentDay')}`
      : '';
    return `${suggestion.name} — ${parts.join(' · ')}${warn}`;
  }

  async function remove(assignmentId: string) {
    await api.delete(`/assignments/${assignmentId}`);
    reload();
  }

  async function toggleSignup(slot: EventSlot) {
    await api.patch(`/signup/slots/${slot.id}`, { open: !slot.openForSignup });
    reload();
  }

  // "Mich eintragen": zählt direkt als Zusage (gleiche API wie das Dashboard)
  async function signupSelf(slotId: string) {
    setSignupError(null);
    try {
      await api.post(`/signup/slots/${slotId}`);
      reload();
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 409
          ? t('assignments.conflictUnavailable')
          : t('common.error');
      setSignupError({ slotId, message });
    }
  }

  if (!event) return <p className="text-muted">{t('common.loading')}</p>;

  const statusLabel: Record<string, string> = {
    ACCEPTED: t('assignments.accepted'),
    REQUESTED: t('assignments.requested'),
    DECLINED: t('assignments.declined'),
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-paper">{event.title}</h1>
        <p className="text-sm text-muted">
          {new Date(event.startsAt).toLocaleString(i18n.language, {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {event.location ? ` · ${event.location}` : ''}
        </p>
      </div>

      <ServicePlan
        eventId={event.id}
        startsAt={event.startsAt}
        items={event.planItems}
        canEdit={event.canEditPlan}
        onSaved={reload}
      />

      {/* Besetzung: beim Drucken ausgeblendet – gedruckt wird der Ablauf */}
      <div className="space-y-3 print:hidden">
        <h2 className="font-semibold text-paper">{t('plans.staffingTitle')}</h2>
        {event.slots.map((slot) => (
          <section key={slot.id} className="card p-4">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: slot.position.team.color }}
              />
              <h2 className="font-semibold text-paper">
                {slot.position.team.name} · {slot.position.name}
              </h2>
              {slot.openForSignup && (
                <span className="badge badge-success">{t('signup.openToggle')}</span>
              )}
              <span className="ml-auto text-sm text-muted">
                {slot.assignments.filter((a) => a.status === 'ACCEPTED').length}/
                {slot.requiredCount}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {slot.assignments.map((assignment) => (
                <li key={assignment.id} className="flex items-center gap-2 text-sm">
                  <span>{assignment.personName}</span>
                  <span className={statusStyle[assignment.status]}>
                    {statusLabel[assignment.status]}
                  </span>
                  {slot.canAssign && (
                    <button
                      onClick={() => void remove(assignment.id)}
                      className="ml-auto text-xs text-faint"
                    >
                      {t('assignments.remove')}
                    </button>
                  )}
                </li>
              ))}
              {slot.assignments.length === 0 && (
                <li className="text-sm text-faint">{t('plans.nobodyAssigned')}</li>
              )}
            </ul>

            {(slot.canSignup || slot.canAssign) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {slot.canSignup && (
                  <button
                    onClick={() => void signupSelf(slot.id)}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    {t('signup.self')}
                  </button>
                )}
                {slot.canAssign && suggestionsFor !== slot.id && (
                  <button
                    onClick={() => void openSuggestions(slot.id)}
                    className="btn-ghost px-3 py-1.5 text-xs font-medium"
                  >
                    {t('signup.assignOther')}
                  </button>
                )}
                {slot.canAssign && (
                  <button
                    onClick={() => void toggleSignup(slot)}
                    className="ml-auto text-xs text-muted underline"
                  >
                    {slot.openForSignup ? t('signup.releaseOff') : t('signup.release')}
                  </button>
                )}
              </div>
            )}
            {signupError?.slotId === slot.id && (
              <p className="mt-2 text-xs text-red-400">{signupError.message}</p>
            )}

            {suggestionsFor === slot.id && (
              <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                {conflict && <p className="mb-2 text-sm text-red-400">{conflict}</p>}
                {suggestions.length === 0 ? (
                  <p className="text-sm text-muted">—</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedPersonId}
                      onChange={(e) => setSelectedPersonId(e.target.value)}
                      className="input min-w-0 flex-1 text-sm sm:max-w-md"
                    >
                      <option value="">{t('assignments.selectPerson')}</option>
                      {suggestions.map((suggestion) => (
                        <option key={suggestion.personId} value={suggestion.personId}>
                          {suggestionLabel(suggestion)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void assign(slot.id, selectedPersonId)}
                      disabled={!selectedPersonId}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      {t('assignments.assign')}
                    </button>
                  </div>
                )}
                <button onClick={() => setSuggestionsFor(null)} className="mt-2 text-xs text-muted">
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
