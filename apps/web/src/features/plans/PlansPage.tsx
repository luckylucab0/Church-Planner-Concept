import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { api } from '../../api/client';

interface EventSummary {
  id: string;
  title: string;
  startsAt: string;
  location?: string | null;
  status: 'PLANNED' | 'PUBLISHED' | 'CANCELLED';
  totalRequired: number;
  totalAccepted: number;
  totalRequested: number;
}

// Kommende Termine mit Besetzungsgrad. Mitglieder sehen nur
// veröffentlichte Termine (serverseitig gefiltert).
export default function PlansPage() {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<EventSummary[]>('/events')
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) return <p className="text-gray-500">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('nav.plans')}</h1>
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              to={`/plans/${event.id}`}
              className="block rounded-xl bg-white p-4 shadow hover:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{event.title}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    event.totalAccepted >= event.totalRequired
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {event.totalAccepted}/{event.totalRequired} {t('plans.staffed')}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {formatDate(event.startsAt)}
                {event.location ? ` · ${event.location}` : ''}
                {event.status === 'PLANNED' ? ` · ${t('plans.draft')}` : ''}
                {event.status === 'CANCELLED' ? ` · ${t('plans.cancelled')}` : ''}
              </p>
            </Link>
          </li>
        ))}
        {events.length === 0 && <p className="text-gray-500">{t('plans.empty')}</p>}
      </ul>
    </div>
  );
}
