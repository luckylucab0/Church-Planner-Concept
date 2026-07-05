import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

export interface EventDetail {
  id: string;
  title: string;
  startsAt: string;
  location?: string | null;
  status: string;
  slots: {
    id: string;
    requiredCount: number;
    position: { id: string; name: string; team: { id: string; name: string; color: string } };
    canAssign: boolean;
    assignments: {
      id: string;
      personId: string;
      personName: string;
      status: 'REQUESTED' | 'ACCEPTED' | 'DECLINED';
    }[];
  }[];
}

const statusStyle: Record<string, string> = {
  ACCEPTED: 'bg-green-100 text-green-700',
  REQUESTED: 'bg-amber-100 text-amber-700',
  DECLINED: 'bg-red-100 text-red-700',
};

// Dienstplan eines Termins: Slots pro Position mit Personen und
// Zusage-Status. Einteilungs-Aktionen (Modul 6) docken hier an.
export default function EventDetailPage() {
  const { t, i18n } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);

  const reload = useCallback(() => {
    if (eventId) void api.get<EventDetail>(`/events/${eventId}`).then(setEvent);
  }, [eventId]);

  useEffect(reload, [reload]);

  if (!event) return <p className="text-gray-500">{t('common.loading')}</p>;

  const statusLabel: Record<string, string> = {
    ACCEPTED: t('assignments.accepted'),
    REQUESTED: t('assignments.requested'),
    DECLINED: t('assignments.declined'),
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{event.title}</h1>
        <p className="text-sm text-gray-500">
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

      <div className="space-y-3">
        {event.slots.map((slot) => (
          <section key={slot.id} className="rounded-xl bg-white p-4 shadow">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: slot.position.team.color }}
              />
              <h2 className="font-semibold">
                {slot.position.team.name} · {slot.position.name}
              </h2>
              <span className="ml-auto text-sm text-gray-500">
                {slot.assignments.filter((a) => a.status === 'ACCEPTED').length}/
                {slot.requiredCount}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {slot.assignments.map((assignment) => (
                <li key={assignment.id} className="flex items-center gap-2 text-sm">
                  <span>{assignment.personName}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${statusStyle[assignment.status]}`}
                  >
                    {statusLabel[assignment.status]}
                  </span>
                </li>
              ))}
              {slot.assignments.length === 0 && (
                <li className="text-sm text-gray-400">{t('plans.nobodyAssigned')}</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
