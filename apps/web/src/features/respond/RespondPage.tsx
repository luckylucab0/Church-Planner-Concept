import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { api, ApiError } from '../../api/client';

interface RespondInfo {
  firstName: string;
  eventTitle: string;
  startsAt: string;
  location?: string | null;
  position: string;
  status: 'REQUESTED' | 'ACCEPTED' | 'DECLINED';
}

// Öffentliche Zusage/Absage-Seite: erreichbar über den Token-Link aus
// der Einteilungs-Mail, ohne Login. Zeigt bewusst nur Vorname + Termin
// (siehe Threat Model). Die Aktion ist ein expliziter POST-Klick –
// kein GET-Side-Effect, damit Mail-Scanner nichts auslösen.
export default function RespondPage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [info, setInfo] = useState<RespondInfo | null>(null);
  const [result, setResult] = useState<'ACCEPTED' | 'DECLINED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // Der Mail-Link kann Zusagen/Absagen vorselektieren (?action=decline)
  const [showReason, setShowReason] = useState(searchParams.get('action') === 'decline');

  useEffect(() => {
    if (!token) return;
    api
      .get<RespondInfo>(`/respond/${token}`)
      .then(setInfo)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 410) {
          const message = (err.body as { message?: string })?.message;
          setError(
            message === 'respond.expired' ? t('respond.expired') : t('respond.alreadyAnswered'),
          );
        } else {
          setError(t('respond.invalid'));
        }
      });
  }, [token, t]);

  async function respond(action: 'accept' | 'decline') {
    try {
      await api.post(`/respond/${token}/${action}`, action === 'decline' ? { reason } : undefined);
      setResult(action === 'accept' ? 'ACCEPTED' : 'DECLINED');
    } catch {
      setError(t('respond.alreadyAnswered'));
    }
  }

  const card = 'card w-full max-w-md p-6 text-center space-y-4';

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink p-4">
        <div className={card}>
          <div className="flex justify-center pb-1">
            <Logo iconSize={26} wordmarkSize={18} />
          </div>
          <p className="text-secondary">{error}</p>
        </div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink p-4">
        <div className={card}>
          <div className="flex justify-center pb-1">
            <Logo iconSize={26} wordmarkSize={18} />
          </div>
          <p className="text-lg text-paper">
            {result === 'ACCEPTED' ? t('respond.accepted') : t('respond.declined')}
          </p>
        </div>
      </main>
    );
  }

  if (!info) {
    return <p className="p-4 text-muted">{t('common.loading')}</p>;
  }

  const date = new Date(info.startsAt).toLocaleString(i18n.language, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className={card}>
        <div className="flex justify-center pb-1">
          <Logo iconSize={26} wordmarkSize={18} />
        </div>
        <h1 className="text-xl font-bold text-paper">
          {t('respond.heading', { firstName: info.firstName })}
        </h1>
        <p className="text-secondary">
          {t('respond.question', {
            date,
            position: info.position,
            eventTitle: info.eventTitle,
          })}
        </p>
        {info.location && <p className="text-sm text-muted">📍 {info.location}</p>}

        <div className="flex flex-col gap-2">
          <button
            onClick={() => void respond('accept')}
            className="rounded-[10px] p-3 font-semibold text-ink"
            style={{ backgroundColor: 'var(--color-success)' }}
          >
            ✓ {t('assignments.accept')}
          </button>
          {!showReason ? (
            <button onClick={() => setShowReason(true)} className="btn-ghost p-3">
              ✕ {t('assignments.decline')}
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('assignments.declineReason')}
                className="input"
              />
              <button onClick={() => void respond('decline')} className="btn-ghost w-full p-3">
                ✕ {t('assignments.decline')}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
