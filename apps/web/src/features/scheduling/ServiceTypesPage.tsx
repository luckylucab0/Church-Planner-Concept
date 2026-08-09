import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import { useSession } from '../auth/SessionContext';
import PositionSlotsEditor, { SlotItem } from '../plans/PositionSlotsEditor';

interface ServiceType {
  id: string;
  name: string;
  rrule: string | null;
  startTime: string | null;
  durationMinutes: number;
  location: string | null;
  positionTemplate: {
    positionId: string;
    requiredCount: number;
    position: { id: string; name: string; team: { name: string; color: string } };
  }[];
}

// Wie bei den Abwesenheiten: Voreinstellungen statt RRULE-Freitext. Wer
// eine exotische Regel braucht, wählt „Eigene Regel" und tippt die RRULE.
const RRULE_PRESETS = [
  { rrule: 'FREQ=WEEKLY;BYDAY=SU', key: 'everySunday' },
  { rrule: 'FREQ=WEEKLY;BYDAY=SU;INTERVAL=2', key: 'everyOtherSunday' },
  { rrule: 'FREQ=MONTHLY;BYDAY=1SU', key: 'firstSunday' },
  { rrule: 'FREQ=WEEKLY;BYDAY=SA', key: 'everySaturday' },
  { rrule: 'FREQ=WEEKLY;BYDAY=WE', key: 'everyWednesday' },
] as const;

const EMPTY_FORM = {
  name: '',
  rrule: RRULE_PRESETS[0].rrule as string,
  customRrule: '',
  startTime: '10:00',
  durationMinutes: 90,
  location: '',
};

// Gottesdienst-Typen: die Serien-Vorlage hinter den Terminen. Ein Typ
// bündelt Wiederholungsregel, Uhrzeit, Dauer, Ort und die Positionen, die
// jeder Termin dieser Serie braucht – „Termine erzeugen" materialisiert
// daraus die einzelnen Termine (idempotent, beliebig oft aufrufbar).
export default function ServiceTypesPage() {
  const { t } = useTranslation();
  // Lesen darf jeder, ändern nur Admins (so setzt es auch die API durch) –
  // ohne das Flag stünden hier Buttons, die für Mitglieder nur 403 liefern.
  const canManage = useSession().session?.globalRole === 'ADMIN';
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templateFor, setTemplateFor] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<SlotItem[]>([]);

  const [generateFor, setGenerateFor] = useState<string | null>(null);
  const [generateUntil, setGenerateUntil] = useState('');
  const [generateResult, setGenerateResult] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<ServiceType[]>('/service-types')
      .then(setTypes)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  function startCreate() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setError(null);
    setFormOpen(true);
  }

  function startEdit(type: ServiceType) {
    const isPreset = RRULE_PRESETS.some((preset) => preset.rrule === type.rrule);
    setForm({
      name: type.name,
      rrule: type.rrule ? (isPreset ? type.rrule : 'CUSTOM') : '',
      customRrule: isPreset ? '' : (type.rrule ?? ''),
      startTime: type.startTime ?? '10:00',
      durationMinutes: type.durationMinutes,
      location: type.location ?? '',
    });
    setEditingId(type.id);
    setError(null);
    setFormOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const rrule = form.rrule === 'CUSTOM' ? form.customRrule.trim() : form.rrule;
    const body = {
      name: form.name,
      ...(rrule ? { rrule } : {}),
      startTime: form.startTime,
      durationMinutes: form.durationMinutes,
      ...(form.location ? { location: form.location } : {}),
    };
    try {
      if (editingId) {
        await api.patch(`/service-types/${editingId}`, body);
      } else {
        await api.post('/service-types', body);
      }
      setFormOpen(false);
      reload();
    } catch (apiError) {
      setError(
        apiError instanceof ApiError && apiError.status === 400
          ? t('serviceTypes.invalidRrule')
          : t('common.error'),
      );
    }
  }

  async function remove(type: ServiceType) {
    if (!window.confirm(t('serviceTypes.deleteConfirm', { name: type.name }))) return;
    await api.delete(`/service-types/${type.id}`);
    reload();
  }

  async function saveTemplate() {
    if (!templateFor) return;
    await api.put(`/service-types/${templateFor}/template`, { items: templateDraft });
    setTemplateFor(null);
    reload();
  }

  async function generate(typeId: string) {
    if (!generateUntil) return;
    setGenerateResult(null);
    try {
      const result = await api.post<{ created: number; skipped: number }>(
        `/service-types/${typeId}/generate`,
        { until: new Date(`${generateUntil}T23:59`).toISOString() },
      );
      setGenerateResult(t('serviceTypes.generateResult', result));
    } catch (apiError) {
      setGenerateResult(
        apiError instanceof ApiError && apiError.status === 400
          ? t('serviceTypes.generateError')
          : t('common.error'),
      );
    }
  }

  function rruleLabel(rrule: string | null): string {
    if (!rrule) return t('serviceTypes.noRrule');
    const preset = RRULE_PRESETS.find((entry) => entry.rrule === rrule);
    return preset ? t(`serviceTypes.presets.${preset.key}`) : rrule;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-paper">
            {t('serviceTypes.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('serviceTypes.hint')}</p>
        </div>
        {canManage && !formOpen && (
          <button onClick={startCreate} className="btn-primary">
            + {t('serviceTypes.create')}
          </button>
        )}
      </div>

      {formOpen && (
        <section className="card p-4">
          <h2 className="mb-3 font-semibold text-paper">
            {editingId ? t('serviceTypes.edit') : t('serviceTypes.create')}
          </h2>
          <form onSubmit={(e) => void save(e)} className="space-y-3">
            <label className="block">
              <span className="text-sm text-secondary">{t('serviceTypes.name')}</span>
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input mt-1.5"
              />
            </label>

            <label className="block">
              <span className="text-sm text-secondary">{t('serviceTypes.rrule')}</span>
              <select
                value={form.rrule}
                onChange={(e) => setForm({ ...form, rrule: e.target.value })}
                className="input mt-1.5"
              >
                {RRULE_PRESETS.map((preset) => (
                  <option key={preset.rrule} value={preset.rrule}>
                    {t(`serviceTypes.presets.${preset.key}`)}
                  </option>
                ))}
                <option value="">{t('serviceTypes.noRrule')}</option>
                <option value="CUSTOM">{t('serviceTypes.customRrule')}</option>
              </select>
            </label>
            {form.rrule === 'CUSTOM' && (
              <label className="block">
                <span className="text-sm text-secondary">{t('serviceTypes.customRrule')}</span>
                <input
                  value={form.customRrule}
                  onChange={(e) => setForm({ ...form, customRrule: e.target.value })}
                  placeholder="FREQ=WEEKLY;BYDAY=SU"
                  className="input mt-1.5 font-mono text-sm"
                />
              </label>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-sm text-secondary">{t('serviceTypes.startTime')}</span>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('serviceTypes.duration')}</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={form.durationMinutes}
                  onChange={(e) =>
                    setForm({ ...form, durationMinutes: Number(e.target.value) || 90 })
                  }
                  className="input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-sm text-secondary">{t('events.location')}</span>
                <input
                  maxLength={200}
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="input mt-1.5"
                />
              </label>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary">
                {t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="text-sm text-muted"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : types.length === 0 ? (
        <p className="text-muted">{t('serviceTypes.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {types.map((type) => (
            <li key={type.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold text-paper">{type.name}</h2>
                  <p className="mt-0.5 text-sm text-muted">
                    {rruleLabel(type.rrule)}
                    {type.startTime ? ` · ${type.startTime}` : ''} · {type.durationMinutes}{' '}
                    {t('plan.minutesShort')}
                    {type.location ? ` · ${type.location}` : ''}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <button onClick={() => startEdit(type)} className="text-faint hover:text-paper">
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => void remove(type)}
                      className="text-faint hover:text-paper"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-2 text-sm">
                <span className="text-secondary">{t('serviceTypes.template')}:</span>{' '}
                <span className="text-muted">
                  {type.positionTemplate.length === 0
                    ? '—'
                    : type.positionTemplate
                        .map(
                          (item) =>
                            `${item.position.team.name} · ${item.position.name} (${item.requiredCount})`,
                        )
                        .join(', ')}
                </span>
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {canManage && templateFor !== type.id && (
                  <button
                    onClick={() => {
                      setTemplateFor(type.id);
                      setTemplateDraft(
                        type.positionTemplate.map((item) => ({
                          positionId: item.positionId,
                          requiredCount: item.requiredCount,
                        })),
                      );
                    }}
                    className="link-gold"
                  >
                    {t('serviceTypes.editTemplate')}
                  </button>
                )}
                {canManage && type.rrule && generateFor !== type.id && (
                  <button
                    onClick={() => {
                      setGenerateFor(type.id);
                      setGenerateResult(null);
                      setGenerateUntil('');
                    }}
                    className="text-faint hover:text-paper"
                  >
                    {t('serviceTypes.generate')}
                  </button>
                )}
              </div>

              {templateFor === type.id && (
                <div className="mt-3 rounded-lg border border-line bg-ink p-3">
                  <PositionSlotsEditor value={templateDraft} onChange={setTemplateDraft} />
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={() => void saveTemplate()}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      {t('common.save')}
                    </button>
                    <button onClick={() => setTemplateFor(null)} className="text-xs text-muted">
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {generateFor === type.id && (
                <div className="mt-3 rounded-lg border border-line bg-ink p-3">
                  <p className="text-xs text-faint">{t('serviceTypes.generateHint')}</p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="text-xs text-faint">{t('serviceTypes.generateUntil')}</span>
                      <input
                        type="date"
                        value={generateUntil}
                        onChange={(e) => setGenerateUntil(e.target.value)}
                        className="input mt-1 w-auto text-sm"
                      />
                    </label>
                    <button
                      onClick={() => void generate(type.id)}
                      disabled={!generateUntil}
                      className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      {t('serviceTypes.generate')}
                    </button>
                    <button onClick={() => setGenerateFor(null)} className="text-xs text-muted">
                      {t('common.cancel')}
                    </button>
                  </div>
                  {generateResult && <p className="mt-2 text-sm text-success">{generateResult}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
