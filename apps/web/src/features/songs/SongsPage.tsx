import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

interface Arrangement {
  id: string;
  name: string;
  key: string | null;
}

interface Song {
  id: string;
  title: string;
  defaultKey: string | null;
  tempoBpm: number | null;
  ccliNumber: string | null;
  arrangements: Arrangement[];
}

interface SongsResponse {
  canManage: boolean;
  songs: Song[];
}

const emptyForm = { title: '', defaultKey: '', tempoBpm: '', ccliNumber: '' };

// Liederdatenbank: Suche für alle, Pflege für Teamleiter/Admins
// (canManage kommt vom Server – die API erzwingt die Rechte selbst).
export default function SongsPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<SongsResponse>({ canManage: false, songs: [] });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [arrangementFor, setArrangementFor] = useState<string | null>(null);
  const [arrangementForm, setArrangementForm] = useState({ name: '', key: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      api
        .get<SongsResponse>(`/songs${search ? `?query=${encodeURIComponent(search)}` : ''}`)
        .then(setData)
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 200); // debounce für die Suche
    return () => clearTimeout(timeout);
  }, [search]);

  const reload = () =>
    api
      .get<SongsResponse>(`/songs${search ? `?query=${encodeURIComponent(search)}` : ''}`)
      .then(setData);

  function startEdit(song: Song) {
    setEditingSongId(song.id);
    setShowForm(true);
    setForm({
      title: song.title,
      defaultKey: song.defaultKey ?? '',
      tempoBpm: song.tempoBpm ? String(song.tempoBpm) : '',
      ccliNumber: song.ccliNumber ?? '',
    });
  }

  async function submitSong() {
    const payload = {
      title: form.title.trim(),
      defaultKey: form.defaultKey.trim() || undefined,
      tempoBpm: form.tempoBpm ? Number(form.tempoBpm) : undefined,
      ccliNumber: form.ccliNumber.trim() || undefined,
    };
    if (editingSongId) await api.patch(`/songs/${editingSongId}`, payload);
    else await api.post('/songs', payload);
    setForm(emptyForm);
    setEditingSongId(null);
    setShowForm(false);
    await reload();
  }

  async function removeSong(songId: string) {
    await api.delete(`/songs/${songId}`);
    await reload();
  }

  async function submitArrangement(songId: string) {
    await api.post(`/songs/${songId}/arrangements`, {
      name: arrangementForm.name.trim(),
      key: arrangementForm.key.trim() || undefined,
    });
    setArrangementFor(null);
    setArrangementForm({ name: '', key: '' });
    await reload();
  }

  async function removeArrangement(songId: string, arrangementId: string) {
    await api.delete(`/songs/${songId}/arrangements/${arrangementId}`);
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('songs.title')}</h1>
        <input
          type="search"
          placeholder={t('songs.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48 rounded-lg border px-3 py-1.5 text-sm sm:w-64"
        />
      </div>

      {data.canManage && !showForm && (
        <button
          onClick={() => {
            setEditingSongId(null);
            setForm(emptyForm);
            setShowForm(true);
          }}
          className="text-sm font-medium text-indigo-600"
        >
          + {t('songs.addSong')}
        </button>
      )}

      {showForm && (
        <section className="rounded-xl bg-white p-4 shadow">
          <div className="grid gap-2 sm:grid-cols-4">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('songs.song')}
              className="rounded border px-2 py-1.5 text-sm sm:col-span-2"
              autoFocus
            />
            <input
              value={form.defaultKey}
              onChange={(e) => setForm({ ...form, defaultKey: e.target.value })}
              placeholder={t('songs.key')}
              className="rounded border px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              value={form.tempoBpm}
              onChange={(e) => setForm({ ...form, tempoBpm: e.target.value })}
              placeholder={`${t('songs.tempo')} (${t('songs.bpm')})`}
              className="rounded border px-2 py-1.5 text-sm"
            />
            <input
              value={form.ccliNumber}
              onChange={(e) => setForm({ ...form, ccliNumber: e.target.value })}
              placeholder={t('songs.ccli')}
              className="rounded border px-2 py-1.5 text-sm sm:col-span-2"
            />
          </div>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => void submitSong()}
              disabled={!form.title.trim()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('common.save')}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500">
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}

      {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {!loading && data.songs.length === 0 && (
        <p className="text-sm text-gray-400">{search ? t('songs.noResults') : t('songs.empty')}</p>
      )}

      <div className="space-y-2">
        {data.songs.map((song) => (
          <section key={song.id} className="rounded-xl bg-white p-4 shadow">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">♪ {song.title}</p>
                <p className="text-sm text-gray-500">
                  {[
                    song.defaultKey ? `${t('songs.key')} ${song.defaultKey}` : null,
                    song.tempoBpm ? `${song.tempoBpm} ${t('songs.bpm')}` : null,
                    song.ccliNumber ? `${t('songs.ccli')} ${song.ccliNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
              {data.canManage && (
                <span className="flex shrink-0 gap-3 text-sm">
                  <button onClick={() => startEdit(song)} className="text-indigo-600">
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => void removeSong(song.id)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    {t('common.delete')}
                  </button>
                </span>
              )}
            </div>

            {(song.arrangements.length > 0 || data.canManage) && (
              <div className="mt-2 text-sm">
                <span className="font-medium text-gray-700">{t('songs.arrangements')}:</span>{' '}
                {song.arrangements.map((arrangement) => (
                  <span
                    key={arrangement.id}
                    className="mr-2 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5"
                  >
                    {arrangement.name}
                    {arrangement.key ? ` (${arrangement.key})` : ''}
                    {data.canManage && (
                      <button
                        onClick={() => void removeArrangement(song.id, arrangement.id)}
                        className="text-gray-400 hover:text-red-600"
                        aria-label={t('common.delete')}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
                {song.arrangements.length === 0 && <span className="text-gray-400">—</span>}
                {data.canManage && arrangementFor !== song.id && (
                  <button
                    onClick={() => {
                      setArrangementFor(song.id);
                      setArrangementForm({ name: '', key: '' });
                    }}
                    className="ml-1 text-indigo-600"
                  >
                    + {t('songs.addArrangement')}
                  </button>
                )}
                {arrangementFor === song.id && (
                  <span className="mt-1 inline-flex gap-2">
                    <input
                      value={arrangementForm.name}
                      onChange={(e) =>
                        setArrangementForm({ ...arrangementForm, name: e.target.value })
                      }
                      placeholder={t('songs.arrangementName')}
                      className="w-32 rounded border px-2 py-0.5"
                      autoFocus
                    />
                    <input
                      value={arrangementForm.key}
                      onChange={(e) =>
                        setArrangementForm({ ...arrangementForm, key: e.target.value })
                      }
                      placeholder={t('songs.key')}
                      className="w-16 rounded border px-2 py-0.5"
                    />
                    <button
                      onClick={() => void submitArrangement(song.id)}
                      disabled={!arrangementForm.name.trim()}
                      className="rounded bg-indigo-600 px-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {t('common.save')}
                    </button>
                    <button
                      onClick={() => setArrangementFor(null)}
                      className="text-xs text-gray-500"
                    >
                      {t('common.cancel')}
                    </button>
                  </span>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
