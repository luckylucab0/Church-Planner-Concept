import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

const TARGET_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'birthday',
  'address',
  'teams',
  'notes',
  'ignore',
] as const;

interface UploadResult {
  id: string;
  headers: string[];
  suggestedMapping: Record<string, string>;
  rowCount: number;
  sampleRows: Record<string, string>[];
}

interface DryRunResult {
  summary: Record<string, number>;
  rows: { rowNumber: number; outcome: string; error?: string; name?: string | null }[];
}

interface ImportJob {
  id: string;
  source: string;
  status: string;
  fileName: string | null;
  createdAt: string;
  dryRunSummary: Record<string, number> | null;
}

type Source = 'ELVANTO_CSV' | 'PCO_CSV' | 'PCO_API';

// Import-Assistent (Admin): Quelle → Mapping prüfen → Dry-Run → Import.
// CSV-Dateien werden clientseitig gelesen und als Text an die API
// geschickt; die PCO-API-Quelle holt die Personen serverseitig ab und
// mündet in denselben Job (gleiches Mapping, gleicher Dry-Run).
export default function ImportPage() {
  const { t, i18n } = useTranslation();
  const [source, setSource] = useState<Source>('ELVANTO_CSV');
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pcoCredentials, setPcoCredentials] = useState({ appId: '', secret: '' });
  const [pcoLoading, setPcoLoading] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);

  const loadJobs = useCallback(() => {
    void api.get<ImportJob[]>('/admin/import').then(setJobs).catch(console.error);
  }, []);

  useEffect(loadJobs, [loadJobs]);

  function startJob(result: UploadResult) {
    setUpload(result);
    setMapping(result.suggestedMapping);
    setDryRun(null);
    setDone(null);
  }

  async function onFile(file: File) {
    setError(null);
    const content = await file.text();
    try {
      startJob(
        await api.post<UploadResult>('/admin/import', {
          source,
          fileName: file.name,
          content,
        }),
      );
    } catch {
      setError(t('import.uploadError'));
    }
  }

  async function loadFromPcoApi(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPcoLoading(true);
    try {
      startJob(await api.post<UploadResult>('/admin/import/pco-api', pcoCredentials));
      setPcoCredentials({ appId: '', secret: '' });
    } catch {
      setError(t('import.pcoApiError'));
    } finally {
      setPcoLoading(false);
    }
  }

  async function runDryRun() {
    if (!upload) return;
    await api.put(`/admin/import/${upload.id}/mapping`, { mapping });
    setDryRun(await api.post<DryRunResult>(`/admin/import/${upload.id}/dry-run`));
  }

  async function confirm() {
    if (!upload) return;
    const result = await api.post<{ summary: Record<string, number> }>(
      `/admin/import/${upload.id}/confirm`,
    );
    setDone(result.summary);
    setDryRun(null);
    loadJobs();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('import.title')}</h1>
      <p className="text-sm text-muted">{t('import.hint')}</p>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            aria-label={t('import.source')}
            className="input w-auto text-sm"
          >
            <option value="ELVANTO_CSV">{t('import.sourceElvanto')}</option>
            <option value="PCO_CSV">{t('import.sourcePco')}</option>
            <option value="PCO_API">{t('import.sourcePcoApi')}</option>
          </select>
          {source !== 'PCO_API' && (
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
              className="text-sm"
            />
          )}
        </div>

        {/* PCO-API: die Zugangsdaten bleiben im Formular und gehen nur an
            den eigenen Server – gespeichert wird nichts davon. */}
        {source === 'PCO_API' && (
          <form onSubmit={(e) => void loadFromPcoApi(e)} className="space-y-2">
            <p className="text-sm text-muted">{t('import.pcoApiHint')}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs text-faint">{t('import.pcoAppId')}</span>
                <input
                  required
                  value={pcoCredentials.appId}
                  onChange={(e) => setPcoCredentials({ ...pcoCredentials, appId: e.target.value })}
                  autoComplete="off"
                  className="input mt-1 w-auto text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-faint">{t('import.pcoSecret')}</span>
                <input
                  required
                  type="password"
                  value={pcoCredentials.secret}
                  onChange={(e) => setPcoCredentials({ ...pcoCredentials, secret: e.target.value })}
                  autoComplete="off"
                  className="input mt-1 w-auto text-sm"
                />
              </label>
              <button type="submit" disabled={pcoLoading} className="btn-primary text-sm">
                {pcoLoading ? t('common.loading') : t('import.pcoApiLoad')}
              </button>
            </div>
          </form>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {upload && !done && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-paper">
            {t('import.mappingTitle')} · {upload.rowCount} {t('import.rows')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {upload.headers.map((header) => (
                  <tr key={header} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium text-paper">{header}</td>
                    <td className="py-1.5 pr-3 text-faint">
                      {upload.sampleRows[0]?.[header] ?? ''}
                    </td>
                    <td>
                      <select
                        value={mapping[header] ?? 'notes'}
                        onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                        className="rounded-[10px] border border-line bg-ink px-2 py-1"
                      >
                        {TARGET_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {t(`import.fields.${field}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => void runDryRun()} className="btn-primary text-sm">
            {t('import.dryRun')}
          </button>
        </section>
      )}

      {dryRun && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-paper">{t('import.previewTitle')}</h2>
          <p className="text-sm">
            ➕ {dryRun.summary.CREATED ?? 0} {t('import.created')} · 🔄{' '}
            {(dryRun.summary.UPDATED ?? 0) + (dryRun.summary.MERGED ?? 0)} {t('import.updated')} · ⏭{' '}
            {dryRun.summary.SKIPPED ?? 0} {t('import.skipped')} · ⚠ {dryRun.summary.ERROR ?? 0}{' '}
            {t('import.errors')}
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-muted">
            {dryRun.rows.map((row) => (
              <li key={row.rowNumber}>
                #{row.rowNumber}: {row.outcome} {row.name ?? ''} {row.error ?? ''}
              </li>
            ))}
          </ul>
          <button
            onClick={() => void confirm()}
            className="rounded-[10px] font-semibold text-ink px-4 py-2 text-sm"
            style={{ backgroundColor: 'var(--color-success)' }}
          >
            {t('import.confirm')}
          </button>
        </section>
      )}

      {done && upload && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold text-paper">{t('import.doneTitle')}</h2>
          <p className="text-sm">
            ➕ {done.CREATED ?? 0} {t('import.created')} · 🔄{' '}
            {(done.UPDATED ?? 0) + (done.MERGED ?? 0)} {t('import.updated')} · ⏭ {done.SKIPPED ?? 0}{' '}
            {t('import.skipped')} · ⚠ {done.ERROR ?? 0} {t('import.errors')}
          </p>
          {((done.ERROR ?? 0) > 0 || (done.SKIPPED ?? 0) > 0) && (
            <a
              href={`/api/v1/admin/import/${upload.id}/errors.csv`}
              className="link-gold text-sm"
              download
            >
              ⬇ {t('import.downloadErrors')}
            </a>
          )}
        </section>
      )}

      {/* Historie: die letzten 20 Vorgänge – ohne sie bliebe nach einem
          Reload unsichtbar, was wann importiert wurde. */}
      {jobs.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold text-paper">{t('import.historyTitle')}</h2>
          <ul className="mt-2 divide-y divide-line">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="text-paper">{job.fileName ?? job.source}</span>
                <span className="badge badge-muted">{job.source}</span>
                <span className="text-muted">{t(`import.jobStatus.${job.status}`)}</span>
                <span className="ml-auto flex items-center gap-3 text-xs text-faint">
                  <span>{new Date(job.createdAt).toLocaleString(i18n.language)}</span>
                  {(job.dryRunSummary?.ERROR ?? 0) > 0 && (
                    <a
                      href={`/api/v1/admin/import/${job.id}/errors.csv`}
                      className="link-gold"
                      download
                    >
                      ⬇ {t('import.errors')}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
