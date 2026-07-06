import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const intent = searchParams.get('action');
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

  const card = 'w-full max-w-md rounded-xl bg-white p-6 shadow text-center space-y-4';

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className={card}>
          <p className="text-gray-700">{error}</p>
        </div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className={card}>
          <p className="text-lg">
            {result === 'ACCEPTED'
              ? t('replacement.accepted')
              : t('replacement.declined', { requesterFirstName: info?.requesterFirstName })}
          </p>
        </div>
      </main>
    );
  }

  if (!info) {
    return <p className="p-4 text-gray-500">{t('common.loading')}</p>;
  }

  const date = new Date(info.startsAt).toLocaleString(i18n.language, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className={card}>
        <h1 className="text-xl font-bold">
          {t('replacement.heading', { firstName: info.firstName })}
        </h1>
        <p className="text-gray-700">
          {t('replacement.question', {
            requesterFirstName: info.requesterFirstName,
            date,
            position: info.position,
            eventTitle: info.eventTitle,
          })}
        </p>
        {info.location && <p className="text-sm text-gray-500">📍 {info.location}</p>}

        <div className="flex flex-col gap-2">
          <button
            onClick={() => void respond('accept')}
            className={`rounded-lg p-3 font-medium text-white ${
              intent === 'decline' ? 'bg-green-500' : 'bg-green-600'
            }`}
          >
            ✓ {t('replacement.accept')}
          </button>
          <button
            onClick={() => void respond('decline')}
            className="rounded-lg border border-red-300 p-3 font-medium text-red-600"
          >
            ✕ {t('replacement.decline')}
          </button>
        </div>
      </div>
    </main>
  );
}
