import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { addMinutes, fromLocalInput, toLocalInput } from '../../lib/datetime';

export type EventStatus = 'PLANNED' | 'PUBLISHED' | 'CANCELLED';

export interface EventFormInitial {
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  status?: EventStatus;
}

export interface ServiceTypeOption {
  id: string;
  name: string;
  startTime: string | null;
  durationMinutes: number;
  location: string | null;
}

// Formular für Termine – im Anlege-Modus mit Gottesdienst-Typ (übernimmt
// Titel, Zeit, Ort und die Positions-Vorlage), im Bearbeiten-Modus
// zusätzlich mit dem Status (Entwurf/veröffentlicht/abgesagt).
export default function EventForm({
  mode,
  initial,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: EventFormInitial & { id: string };
  onSaved: (eventId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [startsAt, setStartsAt] = useState(initial ? toLocalInput(initial.startsAt) : '');
  const [endsAt, setEndsAt] = useState(initial ? toLocalInput(initial.endsAt) : '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [status, setStatus] = useState<EventStatus>(initial?.status ?? 'PLANNED');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'create') return;
    void api.get<ServiceTypeOption[]>('/service-types').then(setServiceTypes).catch(console.error);
  }, [mode]);

  // Typ gewählt: Titel/Ort/Uhrzeit vorbelegen, damit der Regelfall
  // („nächster Gottesdienst") nur noch ein Datum braucht.
  function applyServiceType(id: string) {
    setServiceTypeId(id);
    const type = serviceTypes.find((entry) => entry.id === id);
    if (!type) return;
    if (!title) setTitle(type.name);
    if (!location && type.location) setLocation(type.location);
    if (startsAt && type.startTime) {
      const withTime = `${startsAt.slice(0, 10)}T${type.startTime}`;
      setStartsAt(withTime);
      setEndsAt(addMinutes(withTime, type.durationMinutes));
    }
  }

  // Endzeit automatisch mitziehen, solange sie nicht vor dem Start liegt
  function changeStart(value: string) {
    const type = serviceTypes.find((entry) => entry.id === serviceTypeId);
    setStartsAt(value);
    if (!value) return;
    if (!endsAt || new Date(endsAt) <= new Date(value)) {
      setEndsAt(addMinutes(value, type?.durationMinutes ?? 90));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === 'create') {
        const created = await api.post<{ id: string }>('/events', {
          title,
          startsAt: fromLocalInput(startsAt),
          endsAt: fromLocalInput(endsAt),
          ...(location ? { location } : {}),
          ...(serviceTypeId ? { serviceTypeId } : {}),
        });
        onSaved(created.id);
      } else if (initial) {
        await api.patch(`/events/${initial.id}`, {
          title,
          startsAt: fromLocalInput(startsAt),
          endsAt: fromLocalInput(endsAt),
          location,
          status,
        });
        onSaved(initial.id);
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      {mode === 'create' && serviceTypes.length > 0 && (
        <label className="block">
          <span className="text-sm text-secondary">{t('events.serviceType')}</span>
          <select
            value={serviceTypeId}
            onChange={(e) => applyServiceType(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">{t('events.noServiceType')}</option>
            {serviceTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-faint">{t('events.serviceTypeHint')}</span>
        </label>
      )}

      <label className="block">
        <span className="text-sm text-secondary">{t('events.eventTitle')}</span>
        <input
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input mt-1.5"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-secondary">{t('events.startsAt')}</span>
          <input
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => changeStart(e.target.value)}
            className="input mt-1.5"
          />
        </label>
        <label className="block">
          <span className="text-sm text-secondary">{t('events.endsAt')}</span>
          <input
            type="datetime-local"
            required
            value={endsAt}
            min={startsAt || undefined}
            onChange={(e) => setEndsAt(e.target.value)}
            className="input mt-1.5"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm text-secondary">
          {t('events.location')} <span className="text-faint">({t('common.optional')})</span>
        </span>
        <input
          maxLength={200}
          value={location ?? ''}
          onChange={(e) => setLocation(e.target.value)}
          className="input mt-1.5"
        />
      </label>

      {mode === 'edit' && (
        <label className="block max-w-xs">
          <span className="text-sm text-secondary">{t('events.status')}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EventStatus)}
            className="input mt-1.5"
          >
            <option value="PLANNED">{t('events.statusPLANNED')}</option>
            <option value="PUBLISHED">{t('events.statusPUBLISHED')}</option>
            <option value="CANCELLED">{t('events.statusCANCELLED')}</option>
          </select>
          <span className="mt-1 block text-xs text-faint">{t('events.statusHint')}</span>
        </label>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="btn-primary">
          {mode === 'create' ? t('events.createSubmit') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-muted">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
