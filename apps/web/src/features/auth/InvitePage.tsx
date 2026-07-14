import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { api } from '../../api/client';

// Ziel des Einladungslinks aus der Mail (/invite?token=…): die Person
// setzt ihr Passwort, erst dadurch entsteht ihr Konto. Der Token ist
// single-use und 7 Tage gültig.
export default function InvitePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== repeat) {
      setError(t('profile.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/invite/confirm', { token, password });
      setDone(true);
    } catch {
      setError(t('auth.inviteInvalid'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-5 p-6">
        <div className="flex justify-center py-2">
          <Logo iconSize={30} wordmarkSize={22} />
        </div>
        <h1 className="text-lg font-bold text-paper">{t('auth.inviteTitle')}</h1>

        {done ? (
          <p className="text-sm text-success">{t('auth.inviteDone')}</p>
        ) : !token ? (
          <p className="text-sm text-red-400">{t('auth.inviteInvalid')}</p>
        ) : (
          <>
            <p className="text-sm text-secondary">{t('auth.inviteIntro')}</p>
            <label className="block">
              <span className="text-sm text-secondary">{t('profile.newPassword')}</span>
              <input
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input mt-1.5"
                autoFocus
              />
              <span className="mt-1 block text-xs text-faint">{t('profile.passwordHint')}</span>
            </label>
            <label className="block">
              <span className="text-sm text-secondary">{t('profile.newPasswordRepeat')}</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className="input mt-1.5"
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {t('auth.inviteSubmit')}
            </button>
          </>
        )}

        <p className="text-center">
          <Link to="/login" className="text-sm link-gold">
            {t('auth.backToLogin')}
          </Link>
        </p>
      </form>
    </main>
  );
}
