import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';

interface OpenSlot {
  slotId: string;
  eventId: string;
  eventTitle: string;
  startsAt: string;
  location?: string | null;
  team: { name: string; color: string };
  position: string;
  openCount: number;
}

// "Offene Dienste": zur Selbst-Eintragung freigegebene Slots, für die ich
// die passende Position habe. Eintragen zählt direkt als Zusage.
export default function OpenSignups({ onJoined }: { onJoined?: () => void }) {
  const { t, i18n } = useTranslation();
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api.get<OpenSlot[]>('/signup/open').then(setSlots);
  }, []);

  useEffect(reload, [reload]);

  async function join(slotId: string) {
    setError(null);
    try {
      await api.post(`/signup/slots/${slotId}`);
      setJoined(true);
      reload();
      onJoined?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('common.error') : null);
      reload();
    }
  }

  // Nichts anbieten = Abschnitt ganz ausblenden (Dashboard bleibt ruhig)
  if (slots.length === 0 && !joined) return null;

  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-paper">{t('signup.title')}</h2>
      {joined && <p className="text-sm text-success">{t('signup.joined')}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {slots.length === 0 && <p className="text-sm text-muted">{t('signup.none')}</p>}
      <ul className="space-y-2">
        {slots.map((slot) => (
          <li key={slot.slotId} className="flex items-center gap-2 card p-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slot.team.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {slot.eventTitle} · {slot.team.name} · {slot.position}
              </p>
              <p className="text-xs text-muted">
                {new Date(slot.startsAt).toLocaleString(i18n.language, {
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' · '}
                {t('signup.stillOpen', { count: slot.openCount })}
              </p>
            </div>
            <button
              onClick={() => void join(slot.slotId)}
              className="shrink-0 btn-primary px-3 py-1 text-xs"
            >
              {t('signup.join')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
