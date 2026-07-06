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

  if (loading) return <p className="text-muted">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.plans')}</h1>
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link to={`/plans/${event.id}`} className="block card p-4 hover:bg-surface-hover">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-paper">{event.title}</span>
                <span
                  className={`badge ${
                    event.totalAccepted >= event.totalRequired ? 'badge-success' : 'badge-gold'
                  }`}
                >
                  {event.totalAccepted}/{event.totalRequired} {t('plans.staffed')}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {formatDate(event.startsAt)}
                {event.location ? ` · ${event.location}` : ''}
                {event.status === 'PLANNED' ? ` · ${t('plans.draft')}` : ''}
                {event.status === 'CANCELLED' ? ` · ${t('plans.cancelled')}` : ''}
              </p>
            </Link>
          </li>
        ))}
        {events.length === 0 && <p className="text-muted">{t('plans.empty')}</p>}
      </ul>
    </div>
  );
}
