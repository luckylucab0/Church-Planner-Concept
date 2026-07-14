import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import { useSession } from '../auth/SessionContext';

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
  author: string | null;
  copyright: string | null;
  lyrics: string | null;
  arrangements: Arrangement[];
}

interface SongsResponse {
  canManage: boolean;
  songs: Song[];
}

interface CcliReport {
  licenseNumber: string | null;
  from: string;
  to: string;
  rows: { ccliNumber: string | null; title: string; author: string | null; count: number }[];
}

const emptyForm = {
  title: '',
  defaultKey: '',
  tempoBpm: '',
  ccliNumber: '',
  author: '',
  copyright: '',
  lyrics: '',
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Liederdatenbank: Suche für alle, Pflege für Teamleiter/Admins
// (canManage kommt vom Server – die API erzwingt die Rechte selbst).
export default function SongsPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const isAdmin = session?.globalRole === 'ADMIN';
  const [data, setData] = useState<SongsResponse>({ canManage: false, songs: [] });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [arrangementFor, setArrangementFor] = useState<string | null>(null);
  const [arrangementForm, setArrangementForm] = useState({ name: '', key: '' });
  const [loading, setLoading] = useState(true);
  const [lyricsFor, setLyricsFor] = useState<string | null>(null);

  // Datei-Import
  const fileInput = useRef<HTMLInputElement>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // CCLI-Nutzungsbericht
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const [reportFrom, setReportFrom] = useState(isoDate(sixMonthsAgo));
  const [reportTo, setReportTo] = useState(isoDate(new Date()));
  const [report, setReport] = useState<CcliReport | null>(null);
  const [licenseEdit, setLicenseEdit] = useState('');

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
      author: song.author ?? '',
      copyright: song.copyright ?? '',
      lyrics: song.lyrics ?? '',
    });
  }

  async function submitSong() {
    const payload = {
      title: form.title.trim(),
      defaultKey: form.defaultKey.trim() || undefined,
      tempoBpm: form.tempoBpm ? Number(form.tempoBpm) : undefined,
      ccliNumber: form.ccliNumber.trim() || undefined,
      author: form.author.trim() || undefined,
      copyright: form.copyright.trim() || undefined,
      lyrics: form.lyrics.trim() || undefined,
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

  // --- Datei-Import (ChordPro / SongSelect-Download) ------------

  async function onImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // gleiche Datei erneut wählbar
    if (!file) return;
    setImportNotice(null);
    const content = await file.text();
    try {
      const result = await api.post<{ created: boolean }>('/songs/import', {
        content,
        filename: file.name,
      });
      setImportNotice(result.created ? t('songs.importSuccess') : t('songs.importUpdated'));
      await reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const body = error.body as { code?: string } | null;
        if (body?.code === 'DUPLICATE_CCLI' && window.confirm(t('songs.overwriteConfirm'))) {
          await api.post('/songs/import', { content, filename: file.name, overwrite: true });
          setImportNotice(t('songs.importUpdated'));
          await reload();
          return;
        }
        setImportNotice(t('songs.duplicateCcli'));
      } else if (error instanceof ApiError && error.status === 400) {
        setImportNotice(t('songs.importParseError'));
      } else {
        setImportNotice(t('common.error'));
      }
    }
  }

  // --- CCLI-Bericht ---------------------------------------------

  async function loadReport() {
    const result = await api.get<CcliReport>(
      `/songs/ccli-report?from=${reportFrom}&to=${reportTo}`,
    );
    setReport(result);
    setLicenseEdit(result.licenseNumber ?? '');
  }

  async function saveLicense() {
    await api.put('/songs/ccli-license', { licenseNumber: licenseEdit.trim() });
    setReport((prev) => (prev ? { ...prev, licenseNumber: licenseEdit.trim() } : prev));
  }

  function downloadCsv() {
    if (!report) return;
    const header = 'CCLI-Nr.;Titel;Autor;Anzahl';
    const lines = report.rows.map((row) =>
      [row.ccliNumber ?? '', row.title, row.author ?? '', row.count]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(';'),
    );
    const meta = `"CCLI-Lizenz";"${report.licenseNumber ?? '—'}";"${report.from} – ${report.to}";""`;
    // BOM, damit Excel das UTF-8-CSV korrekt öffnet
    const blob = new Blob(['\uFEFF' + [meta, header, ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ccli-bericht-${report.from}-${report.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('songs.title')}</h1>
        <input
          type="search"
          placeholder={t('songs.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-48 sm:w-64"
        />
      </div>

      {data.canManage && !showForm && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => {
              setEditingSongId(null);
              setForm(emptyForm);
              setShowForm(true);
            }}
            className="text-sm font-medium link-gold"
          >
            + {t('songs.addSong')}
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            className="text-sm font-medium link-gold"
          >
            ⬆ {t('songs.import')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".cho,.chopro,.pro,.chordpro,.txt"
            onChange={(e) => void onImportFile(e)}
            className="hidden"
          />
          {importNotice && <span className="text-sm text-muted">{importNotice}</span>}
        </div>
      )}

      {showForm && (
        <section className="card p-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('songs.song')}
              className="input sm:col-span-2"
              autoFocus
            />
            <input
              value={form.defaultKey}
              onChange={(e) => setForm({ ...form, defaultKey: e.target.value })}
              placeholder={t('songs.key')}
              className="input"
            />
            <input
              type="number"
              value={form.tempoBpm}
              onChange={(e) => setForm({ ...form, tempoBpm: e.target.value })}
              placeholder={`${t('songs.tempo')} (${t('songs.bpm')})`}
              className="input"
            />
            <input
              value={form.ccliNumber}
              onChange={(e) => setForm({ ...form, ccliNumber: e.target.value })}
              placeholder={t('songs.ccli')}
              className="input sm:col-span-2"
            />
            <input
              value={form.author}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
              placeholder={t('songs.author')}
              className="input sm:col-span-2"
            />
            <input
              value={form.copyright}
              onChange={(e) => setForm({ ...form, copyright: e.target.value })}
              placeholder={t('songs.copyright')}
              className="input sm:col-span-4"
            />
            <textarea
              value={form.lyrics}
              onChange={(e) => setForm({ ...form, lyrics: e.target.value })}
              placeholder={t('songs.lyrics')}
              rows={6}
              className="input font-mono text-sm sm:col-span-4"
            />
          </div>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => void submitSong()}
              disabled={!form.title.trim()}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t('common.save')}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-muted">
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}

      {loading && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {!loading && data.songs.length === 0 && (
        <p className="text-sm text-faint">{search ? t('songs.noResults') : t('songs.empty')}</p>
      )}

      <div className="space-y-2">
        {data.songs.map((song) => (
          <section key={song.id} className="card p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-paper">♪ {song.title}</p>
                <p className="text-sm text-muted">
                  {[
                    song.author,
                    song.defaultKey ? `${t('songs.key')} ${song.defaultKey}` : null,
                    song.tempoBpm ? `${song.tempoBpm} ${t('songs.bpm')}` : null,
                    song.ccliNumber ? `${t('songs.ccli')} ${song.ccliNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
                {song.copyright && <p className="text-xs text-faint">{song.copyright}</p>}
              </div>
              <span className="flex shrink-0 gap-3 text-sm">
                {song.lyrics && (
                  <button
                    onClick={() => setLyricsFor(lyricsFor === song.id ? null : song.id)}
                    className="text-gold"
                  >
                    {lyricsFor === song.id ? t('songs.hideLyrics') : t('songs.showLyrics')}
                  </button>
                )}
                {data.canManage && (
                  <>
                    <button onClick={() => startEdit(song)} className="text-gold">
                      {t('common.edit')}
                    </button>
                    <button onClick={() => void removeSong(song.id)} className="text-faint">
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </span>
            </div>

            {lyricsFor === song.id && song.lyrics && (
              <pre className="mt-3 overflow-x-auto rounded-[10px] border border-line bg-ink p-3 font-mono text-sm whitespace-pre-wrap text-secondary">
                {song.lyrics}
              </pre>
            )}

            {(song.arrangements.length > 0 || data.canManage) && (
              <div className="mt-2 text-sm">
                <span className="font-medium text-secondary">{t('songs.arrangements')}:</span>{' '}
                {song.arrangements.map((arrangement) => (
                  <span
                    key={arrangement.id}
                    className="mr-2 inline-flex items-center gap-1 rounded bg-avatar px-1.5 py-0.5 border border-line"
                  >
                    {arrangement.name}
                    {arrangement.key ? ` (${arrangement.key})` : ''}
                    {data.canManage && (
                      <button
                        onClick={() => void removeArrangement(song.id, arrangement.id)}
                        className="text-faint"
                        aria-label={t('common.delete')}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
                {song.arrangements.length === 0 && <span className="text-faint">—</span>}
                {data.canManage && arrangementFor !== song.id && (
                  <button
                    onClick={() => {
                      setArrangementFor(song.id);
                      setArrangementForm({ name: '', key: '' });
                    }}
                    className="ml-1 text-gold"
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
                      className="w-32 rounded-[10px] border border-line bg-ink px-2 py-1"
                      autoFocus
                    />
                    <input
                      value={arrangementForm.key}
                      onChange={(e) =>
                        setArrangementForm({ ...arrangementForm, key: e.target.value })
                      }
                      placeholder={t('songs.key')}
                      className="w-16 rounded-[10px] border border-line bg-ink px-2 py-1"
                    />
                    <button
                      onClick={() => void submitArrangement(song.id)}
                      disabled={!arrangementForm.name.trim()}
                      className="btn-primary px-2 text-xs disabled:opacity-50"
                    >
                      {t('common.save')}
                    </button>
                    <button onClick={() => setArrangementFor(null)} className="text-xs text-muted">
                      {t('common.cancel')}
                    </button>
                  </span>
                )}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* CCLI-Nutzungsbericht: Hilfe fürs manuelle Melden im CCLI-Portal */}
      {data.canManage && (
        <section className="card space-y-3 p-4">
          <h2 className="font-medium text-paper">{t('songs.ccliReport')}</h2>
          <p className="text-xs text-faint">{t('songs.ccliReportHint')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-sm text-secondary">{t('songs.reportFrom')}</span>
              <input
                type="date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
                className="input mt-1.5"
              />
            </label>
            <label className="block">
              <span className="text-sm text-secondary">{t('songs.reportTo')}</span>
              <input
                type="date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
                className="input mt-1.5"
              />
            </label>
            <button onClick={() => void loadReport()} className="btn-primary">
              {t('songs.generateReport')}
            </button>
            {report && report.rows.length > 0 && (
              <button onClick={downloadCsv} className="btn-ghost">
                {t('songs.downloadCsv')}
              </button>
            )}
          </div>

          {report && (
            <>
              <p className="text-sm text-muted">
                {t('songs.ccliLicense')}:{' '}
                {isAdmin ? (
                  <span className="inline-flex items-center gap-2">
                    <input
                      value={licenseEdit}
                      onChange={(e) => setLicenseEdit(e.target.value)}
                      placeholder="—"
                      className="input w-32 py-1 text-sm"
                      maxLength={50}
                    />
                    <button onClick={() => void saveLicense()} className="text-xs link-gold">
                      {t('common.save')}
                    </button>
                  </span>
                ) : (
                  <span className="text-paper">{report.licenseNumber ?? '—'}</span>
                )}
              </p>
              {report.rows.length === 0 ? (
                <p className="text-sm text-faint">{t('songs.noUsage')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs text-faint">
                        <th className="py-2 pr-4">{t('songs.ccli')}</th>
                        <th className="py-2 pr-4">{t('songs.song')}</th>
                        <th className="py-2 pr-4">{t('songs.author')}</th>
                        <th className="py-2 text-right">{t('songs.usageCount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr key={`${row.ccliNumber}-${row.title}`} className="border-b border-line">
                          <td className="py-2 pr-4 text-muted">{row.ccliNumber ?? '—'}</td>
                          <td className="py-2 pr-4 text-paper">{row.title}</td>
                          <td className="py-2 pr-4 text-muted">{row.author ?? '—'}</td>
                          <td className="py-2 text-right font-medium text-paper">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
