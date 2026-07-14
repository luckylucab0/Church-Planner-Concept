import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { api } from '../../api/client';

// „Passwort vergessen": fordert die Reset-Mail an. Die Antwort ist
// bewusst immer gleich – ob die Adresse existiert, wird nicht verraten.
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/auth/password-reset', { email });
    } finally {
      // Auch bei Fehlern (z. B. Rate-Limit) keine Details preisgeben
      setSent(true);
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-5 p-6">
        <div className="flex justify-center py-2">
          <Logo iconSize={30} wordmarkSize={22} />
        </div>
        <h1 className="text-lg font-bold text-paper">{t('auth.resetTitle')}</h1>

        {sent ? (
          <p className="text-sm text-success">{t('auth.resetRequested')}</p>
        ) : (
          <>
            <p className="text-sm text-secondary">{t('auth.resetIntro')}</p>
            <label className="block">
              <span className="text-sm text-secondary">{t('auth.email')}</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input mt-1.5"
                autoFocus
              />
            </label>
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {t('auth.resetSend')}
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
