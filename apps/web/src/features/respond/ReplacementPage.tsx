import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { api, ApiError } from '../../api/client';

interface ReplacementInfo {
  firstName: string;
  requesterFirstName: string;
  eventTitle: string;
  startsAt: string;
  location?: string | null;
  position: string;
}

// Öffentliche Übernahme-Seite für Vertretungsanfragen: erreichbar über den
// Token-Link aus der Mail, ohne Login. Wie die Respond-Seite zeigt sie nur
// Vornamen + Termin, und die Aktion ist ein expliziter POST-Klick.
export default function ReplacementPage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  useSearchParams(); // action-Param wird hier nicht vorselektiert
  const [info, setInfo] = useState<ReplacementInfo | null>(null);
  const [result, setResult] = useState<'ACCEPTED' | 'DECLINED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<ReplacementInfo>(`/replacement/${token}`)
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
      await api.post(`/replacement/${token}/${action}`);
      setResult(action === 'accept' ? 'ACCEPTED' : 'DECLINED');
    } catch {
      setError(t('respond.alreadyAnswered'));
    }
  }

  const card = 'card w-full max-w-md p-6 text-center space-y-4';
  const logo = (
    <div className="flex justify-center pb-1">
      <Logo iconSize={26} wordmarkSize={18} />
    </div>
  );

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink p-4">
        <div className={card}>
          {logo}
          <p className="text-secondary">{error}</p>
        </div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink p-4">
        <div className={card}>
          {logo}
          <p className="text-lg text-paper">
            {result === 'ACCEPTED'
              ? t('replacement.accepted')
              : t('replacement.declined', { requesterFirstName: info?.requesterFirstName })}
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
        {logo}
        <h1 className="text-xl font-bold text-paper">
          {t('replacement.heading', { firstName: info.firstName })}
        </h1>
        <p className="text-secondary">
          {t('replacement.question', {
            requesterFirstName: info.requesterFirstName,
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
            ✓ {t('replacement.accept')}
          </button>
          <button onClick={() => void respond('decline')} className="btn-ghost p-3">
            ✕ {t('replacement.decline')}
          </button>
        </div>
      </div>
    </main>
  );
}
