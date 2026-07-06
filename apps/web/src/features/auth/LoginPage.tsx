import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { ApiError } from '../../api/client';
import { useSession } from './SessionContext';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  // 2FA-Feld erst zeigen, wenn die API es verlangt (TOTP_REQUIRED)
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, needsTotp ? totpCode : undefined);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && (err.body as { code?: string })?.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
      } else {
        setError(t('auth.invalidCredentials'));
      }
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

        <label className="block">
          <span className="text-sm text-secondary">{t('auth.email')}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mt-1.5"
          />
        </label>

        <label className="block">
          <span className="text-sm text-secondary">{t('auth.password')}</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mt-1.5"
          />
        </label>

        {needsTotp && (
          <label className="block">
            <span className="text-sm text-secondary">{t('auth.twoFactorCode')}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className="input mt-1.5"
            />
          </label>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {t('auth.login')}
        </button>
      </form>
    </main>
  );
}
