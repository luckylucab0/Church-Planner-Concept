import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import EventForm from './EventForm';
import { api } from '../../api/client';
import { useSession } from '../auth/SessionContext';

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

type StatusFilter = 'ALL' | 'PLANNED' | 'PUBLISHED' | 'CANCELLED' | 'UNDERSTAFFED';

// Kommende Termine mit Besetzungsgrad, nach Monat gruppiert. Mitglieder
// sehen nur veröffentlichte Termine (serverseitig gefiltert); wer das Recht
// „Termine verwalten" hat, legt hier neue Termine an.
export default function PlansPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { session } = useSession();
  const canManageEvents = session?.canManageEvents ?? false;

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const reload = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', new Date(`${from}T00:00`).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59`).toISOString());
    const query = params.toString();
    setLoading(true);
    api
      .get<EventSummary[]>(`/events${query ? `?${query}` : ''}`)
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(reload, [reload]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return events.filter((event) => {
      if (needle && !`${event.title} ${event.location ?? ''}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'UNDERSTAFFED') {
        return event.status !== 'CANCELLED' && event.totalAccepted < event.totalRequired;
      }
      return event.status === statusFilter;
    });
  }, [events, search, statusFilter]);

  // Nach Monat gruppieren: die flache Liste wird ab ~10 Terminen
  // unübersichtlich, Monatsköpfe geben ihr eine Kalender-Struktur.
  const months = useMemo(() => {
    const groups = new Map<string, { label: string; events: EventSummary[] }>();
    for (const event of filtered) {
      const date = new Date(event.startsAt);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const label = date.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
      const group = groups.get(key) ?? { label, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [filtered, i18n.language]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.plans')}</h1>
        {canManageEvents && !creating && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            + {t('events.create')}
          </button>
        )}
      </div>

      {creating && (
        <section className="card p-4">
          <h2 className="mb-3 font-semibold text-paper">{t('events.create')}</h2>
          <EventForm
            mode="create"
            onSaved={(eventId) => navigate(`/plans/${eventId}`)}
            onCancel={() => setCreating(false)}
          />
        </section>
      )}

      {/* Filterleiste: Suche, Status und Zeitraum. Der Zeitraum geht an die
          API (from/to), Suche und Status filtern clientseitig. */}
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-[10rem] flex-1">
          <span className="text-xs text-faint">{t('common.search')}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('events.searchPlaceholder')}
            className="input mt-1 text-sm"
          />
        </label>
        <label>
          <span className="text-xs text-faint">{t('events.status')}</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="input mt-1 w-auto text-sm"
          >
            <option value="ALL">{t('events.filterAll')}</option>
            <option value="UNDERSTAFFED">{t('events.filterUnderstaffed')}</option>
            <option value="PUBLISHED">{t('events.statusPUBLISHED')}</option>
            <option value="PLANNED">{t('events.statusPLANNED')}</option>
            <option value="CANCELLED">{t('events.statusCANCELLED')}</option>
          </select>
        </label>
        <label>
          <span className="text-xs text-faint">{t('events.from')}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input mt-1 w-auto text-sm"
          />
        </label>
        <label>
          <span className="text-xs text-faint">{t('events.to')}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input mt-1 w-auto text-sm"
          />
        </label>
      </div>

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted">{t('plans.empty')}</p>
      ) : (
        months.map((month) => (
          <section key={month.label} className="space-y-2">
            <h2 className="text-sm font-semibold text-secondary">{month.label}</h2>
            <ul className="space-y-2">
              {month.events.map((event) => (
                <li key={event.id}>
                  <Link to={`/plans/${event.id}`} className="block card p-4 hover:bg-surface-hover">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-paper">{event.title}</span>
                      <span
                        className={`badge ${
                          event.totalAccepted >= event.totalRequired
                            ? 'badge-success'
                            : 'badge-gold'
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
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
