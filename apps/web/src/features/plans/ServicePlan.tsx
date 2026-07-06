import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

export interface PlanSong {
  id: string;
  title: string;
  defaultKey: string | null;
  tempoBpm: number | null;
  ccliNumber: string | null;
}

export interface PlanArrangement {
  id: string;
  name: string;
  key: string | null;
}

export interface PlanItem {
  id: string;
  title: string;
  durationMinutes: number;
  notes: string | null;
  song: PlanSong | null;
  arrangement: PlanArrangement | null;
  responsiblePerson: { id: string; name: string } | null;
}

interface SongWithArrangements extends PlanSong {
  arrangements: PlanArrangement[];
}

interface PersonOption {
  id: string;
  firstName: string;
  lastName: string;
}

// Ein Programmpunkt im Editor: gleiche Felder wie PlanItem, aber ohne id
// (der Server ersetzt die Liste komplett) und mit editierbaren Referenzen.
interface DraftItem {
  title: string;
  durationMinutes: number;
  notes: string;
  songId: string | null;
  arrangementId: string | null;
  responsiblePersonId: string | null;
}

function toDraft(item: PlanItem): DraftItem {
  return {
    title: item.title,
    durationMinutes: item.durationMinutes,
    notes: item.notes ?? '',
    songId: item.song?.id ?? null,
    arrangementId: item.arrangement?.id ?? null,
    responsiblePersonId: item.responsiblePerson?.id ?? null,
  };
}

// Liedzeile kompakt: Titel · Arrangement · Tonart · Tempo · CCLI –
// nur die Angaben, die gepflegt sind.
function songLine(song: PlanSong, arrangement: PlanArrangement | null): string {
  return [
    song.title,
    arrangement?.name,
    arrangement?.key ?? song.defaultKey,
    song.tempoBpm ? `${song.tempoBpm} BPM` : null,
    song.ccliNumber ? `CCLI ${song.ccliNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Gottesdienst-Ablauf eines Termins: Lese-Ansicht für alle, Editor für
// Teamleiter/Admins (canEdit kommt serverseitig berechnet aus der API).
// Uhrzeiten werden kumulativ aus Startzeit + Dauern berechnet.
export default function ServicePlan({
  eventId,
  startsAt,
  items,
  canEdit,
  onSaved,
}: {
  eventId: string;
  startsAt: string;
  items: PlanItem[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [songs, setSongs] = useState<SongWithArrangements[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [newSongFor, setNewSongFor] = useState<number | null>(null);
  const [newSongTitle, setNewSongTitle] = useState('');
  const [saving, setSaving] = useState(false);

  // Auswahllisten erst laden, wenn wirklich editiert wird
  useEffect(() => {
    if (!editing) return;
    void api
      .get<{ songs: SongWithArrangements[] }>('/songs')
      .then((response) => setSongs(response.songs));
    void api.get<PersonOption[]>('/people').then(setPeople);
  }, [editing]);

  const startTimes = useMemo(() => {
    const source = editing ? draft : items;
    let cursor = new Date(startsAt).getTime();
    return source.map((item) => {
      const start = new Date(cursor);
      cursor += item.durationMinutes * 60_000;
      return start;
    });
  }, [editing, draft, items, startsAt]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  function startEditing() {
    setDraft(items.map(toDraft));
    setEditing(true);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setDraft((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function move(index: number, delta: -1 | 1) {
    setDraft((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function createSong(index: number) {
    if (!newSongTitle.trim()) return;
    const song = await api.post<SongWithArrangements>('/songs', { title: newSongTitle.trim() });
    setSongs((current) =>
      [...current, { ...song, arrangements: song.arrangements ?? [] }].sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
    );
    updateItem(index, { songId: song.id, arrangementId: null });
    setNewSongFor(null);
    setNewSongTitle('');
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/events/${eventId}/plan`, {
        items: draft.map((item) => ({
          title: item.title,
          durationMinutes: item.durationMinutes,
          notes: item.notes || undefined,
          songId: item.songId ?? undefined,
          arrangementId: item.arrangementId ?? undefined,
          responsiblePersonId: item.responsiblePersonId ?? undefined,
        })),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const totalMinutes = (editing ? draft : items).reduce(
    (sum, item) => sum + item.durationMinutes,
    0,
  );

  return (
    <section className="card p-4 print:p-0 print:shadow-none">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-paper">{t('plan.title')}</h2>
        {(editing ? draft : items).length > 0 && (
          <span className="text-sm text-muted">
            {t('plan.totalDuration')}: {totalMinutes} {t('plan.minutesShort')}
          </span>
        )}
        <span className="ml-auto flex gap-3 print:hidden">
          {items.length > 0 && !editing && (
            <button onClick={() => window.print()} className="text-sm text-muted">
              🖨 {t('plan.print')}
            </button>
          )}
          {canEdit && !editing && (
            <button onClick={startEditing} className="text-sm link-gold">
              {t('plan.editPlan')}
            </button>
          )}
        </span>
      </div>

      {!editing && items.length === 0 && (
        <p className="mt-2 text-sm text-faint">{t('plan.empty')}</p>
      )}

      {/* Lese-Ansicht: kompakte Zeitleiste, druckfreundlich */}
      {!editing && items.length > 0 && (
        <ol className="mt-3 divide-y divide-line">
          {items.map((item, index) => (
            <li key={item.id} className="flex gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 font-mono text-muted">
                {formatTime(startTimes[index])}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.title}</p>
                {item.song && (
                  <p className="text-muted">♪ {songLine(item.song, item.arrangement)}</p>
                )}
                {item.notes && <p className="text-muted">{item.notes}</p>}
              </div>
              <div className="shrink-0 text-right text-muted">
                <p>
                  {item.durationMinutes} {t('plan.minutesShort')}
                </p>
                {item.responsiblePerson && <p>{item.responsiblePerson.name}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Editor: ganze Liste bearbeiten, Speichern ersetzt den Ablauf */}
      {editing && (
        <div className="mt-3 space-y-3 print:hidden">
          {draft.map((item, index) => {
            const song = songs.find((s) => s.id === item.songId);
            return (
              <div key={index} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 font-mono text-sm text-muted">
                    {formatTime(startTimes[index])}
                  </span>
                  <input
                    value={item.title}
                    onChange={(e) => updateItem(index, { title: e.target.value })}
                    placeholder={t('plan.itemTitle')}
                    className="min-w-0 flex-1 input text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.durationMinutes}
                    onChange={(e) =>
                      updateItem(index, { durationMinutes: Number(e.target.value) || 0 })
                    }
                    className="w-16 rounded-[10px] border border-line bg-ink px-2 py-1 text-sm"
                    aria-label={t('plan.duration')}
                  />
                  <span className="text-xs text-muted">{t('plan.minutesShort')}</span>
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="px-1 text-faint disabled:opacity-30"
                    aria-label={t('plan.moveUp')}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === draft.length - 1}
                    className="px-1 text-faint disabled:opacity-30"
                    aria-label={t('plan.moveDown')}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setDraft((c) => c.filter((_, i) => i !== index))}
                    className="px-1 text-faint"
                    aria-label={t('common.delete')}
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <select
                    value={item.songId ?? ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setNewSongFor(index);
                        setNewSongTitle('');
                      } else {
                        updateItem(index, {
                          songId: e.target.value || null,
                          arrangementId: null,
                        });
                      }
                    }}
                    className="input text-sm"
                    aria-label={t('plan.song')}
                  >
                    <option value="">{t('plan.noSong')}</option>
                    {songs.map((s) => (
                      <option key={s.id} value={s.id}>
                        ♪ {s.title}
                        {s.defaultKey ? ` (${s.defaultKey})` : ''}
                      </option>
                    ))}
                    <option value="__new__">+ {t('songs.addSong')}…</option>
                  </select>

                  {song && song.arrangements.length > 0 && (
                    <select
                      value={item.arrangementId ?? ''}
                      onChange={(e) => updateItem(index, { arrangementId: e.target.value || null })}
                      className="input text-sm"
                      aria-label={t('songs.arrangementName')}
                    >
                      <option value="">{t('songs.arrangementName')} —</option>
                      {song.arrangements.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.key ? ` (${a.key})` : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={item.responsiblePersonId ?? ''}
                    onChange={(e) =>
                      updateItem(index, { responsiblePersonId: e.target.value || null })
                    }
                    className="input text-sm"
                    aria-label={t('plan.responsible')}
                  >
                    <option value="">{t('plan.responsible')} —</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </select>
                </div>

                {newSongFor === index && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newSongTitle}
                      onChange={(e) => setNewSongTitle(e.target.value)}
                      placeholder={t('songs.song')}
                      className="min-w-0 flex-1 input text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => void createSong(index)}
                      className="btn-primary px-2 py-1 text-xs"
                    >
                      {t('songs.addSong')}
                    </button>
                    <button onClick={() => setNewSongFor(null)} className="text-xs text-muted">
                      {t('common.cancel')}
                    </button>
                  </div>
                )}

                <input
                  value={item.notes}
                  onChange={(e) => updateItem(index, { notes: e.target.value })}
                  placeholder={t('plan.notes')}
                  className="mt-2 w-full input text-sm"
                />
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                setDraft((c) => [
                  ...c,
                  {
                    title: '',
                    durationMinutes: 5,
                    notes: '',
                    songId: null,
                    arrangementId: null,
                    responsiblePersonId: null,
                  },
                ])
              }
              className="text-sm link-gold"
            >
              + {t('plan.addItem')}
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || draft.some((item) => !item.title.trim())}
              className="ml-auto btn-primary px-3 py-1.5 text-sm"
            >
              {t('plan.savePlan')}
            </button>
            <button onClick={() => setEditing(false)} className="text-sm text-muted">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
