import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

interface Absence {
  id: string;
  fromDate: string;
  toDate: string;
  reason?: string | null;
}

interface Recurring {
  id: string;
  rrule: string;
  note?: string | null;
}

// Voreinstellungen statt RRULE-Freitext: Ehrenamtliche sollen keine
// RFC-5545-Syntax lernen müssen. Die API akzeptiert trotzdem jede
// gültige RRULE (Power-User via Swagger).
const RECURRING_PRESETS = [
  { rrule: 'FREQ=MONTHLY;BYDAY=1SU', key: 'firstSunday' },
  { rrule: 'FREQ=MONTHLY;BYDAY=2SU', key: 'secondSunday' },
  { rrule: 'FREQ=MONTHLY;BYDAY=3SU', key: 'thirdSunday' },
  { rrule: 'FREQ=MONTHLY;BYDAY=4SU', key: 'fourthSunday' },
  { rrule: 'FREQ=WEEKLY;BYDAY=SA', key: 'everySaturday' },
] as const;

export default function AvailabilityPage() {
  const { t, i18n } = useTranslation();
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<string>(RECURRING_PRESETS[0].rrule);

  const reload = useCallback(() => {
    void api.get<Absence[]>('/me/absences').then(setAbsences);
    void api.get<Recurring[]>('/me/recurring-unavailabilities').then(setRecurring);
  }, []);

  useEffect(reload, [reload]);

  async function addAbsence() {
    if (!fromDate || !toDate) return;
    await api.post('/me/absences', { fromDate, toDate, reason: reason || undefined });
    setFromDate('');
    setToDate('');
    setReason('');
    reload();
  }

  async function addRecurring() {
    const presetEntry = RECURRING_PRESETS.find((p) => p.rrule === preset);
    await api.post('/me/recurring-unavailabilities', {
      rrule: preset,
      note: presetEntry ? t(`availability.presets.${presetEntry.key}`) : undefined,
    });
    reload();
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const presetLabel = (rrule: string) => {
    const entry = RECURRING_PRESETS.find((p) => p.rrule === rrule);
    return entry ? t(`availability.presets.${entry.key}`) : rrule;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{t('nav.availability')}</h1>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow">
        <h2 className="font-semibold">{t('availability.absencesTitle')}</h2>
        <ul className="space-y-1">
          {absences.map((absence) => (
            <li key={absence.id} className="flex items-center gap-2 text-sm">
              <span>
                {formatDate(absence.fromDate)} – {formatDate(absence.toDate)}
                {absence.reason ? ` · ${absence.reason}` : ''}
              </span>
              <button
                onClick={() => void api.delete(`/me/absences/${absence.id}`).then(reload)}
                className="ml-auto text-xs text-gray-400 hover:text-red-600"
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
          {absences.length === 0 && (
            <li className="text-sm text-gray-400">{t('availability.noAbsences')}</li>
          )}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-gray-600">{t('availability.from')}</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-gray-300 p-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600">{t('availability.to')}</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-gray-300 p-2"
            />
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`${t('availability.reason')} (${t('common.optional')})`}
            className="rounded-lg border border-gray-300 p-2 text-sm"
          />
          <button
            onClick={() => void addAbsence()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          >
            + {t('availability.add')}
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow">
        <h2 className="font-semibold">{t('availability.recurringTitle')}</h2>
        <p className="text-sm text-gray-500">{t('availability.recurringHint')}</p>
        <ul className="space-y-1">
          {recurring.map((rule) => (
            <li key={rule.id} className="flex items-center gap-2 text-sm">
              <span>{rule.note || presetLabel(rule.rrule)}</span>
              <button
                onClick={() =>
                  void api.delete(`/me/recurring-unavailabilities/${rule.id}`).then(reload)
                }
                className="ml-auto text-xs text-gray-400 hover:text-red-600"
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="rounded-lg border border-gray-300 p-2 text-sm"
          >
            {RECURRING_PRESETS.map((entry) => (
              <option key={entry.rrule} value={entry.rrule}>
                {t(`availability.presets.${entry.key}`)}
              </option>
            ))}
          </select>
          <button
            onClick={() => void addRecurring()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          >
            + {t('availability.add')}
          </button>
        </div>
      </section>
    </div>
  );
}
