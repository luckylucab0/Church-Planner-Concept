import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TwoFactorSetup from './TwoFactorSetup';
import { api, ApiError } from '../../api/client';

// Sicherheits-Sektion des Profils: Passwort ändern (aktuelles Passwort
// als Nachweis; andere Sessions beendet der Server automatisch) sowie
// die Zwei-Faktor-Authentisierung (siehe TwoFactorSetup).
export default function SecuritySection() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function changePassword() {
    setMessage(null);
    if (next !== repeat) {
      setMessage({ kind: 'error', text: t('profile.passwordMismatch') });
      return;
    }
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setMessage({ kind: 'ok', text: t('profile.passwordChanged') });
    } catch (error) {
      const text =
        error instanceof ApiError && error.status === 401
          ? t('auth.wrongPassword')
          : t('common.error');
      setMessage({ kind: 'error', text });
    }
  }

  const fields = [
    { key: 'current', label: t('profile.currentPassword'), value: current, set: setCurrent },
    { key: 'next', label: t('profile.newPassword'), value: next, set: setNext },
    { key: 'repeat', label: t('profile.newPasswordRepeat'), value: repeat, set: setRepeat },
  ];

  return (
    <section id="sicherheit" className="card space-y-3 p-4">
      <h2 className="font-semibold text-paper">{t('profile.securityTitle')}</h2>
      <div>
        <h3 className="text-sm font-medium text-secondary">{t('profile.changePassword')}</h3>
        <p className="text-xs text-faint">{t('profile.passwordHint')}</p>
      </div>
      <div className="grid gap-2 sm:max-w-sm">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="text-sm text-secondary">{field.label}</span>
            <input
              type="password"
              autoComplete={field.key === 'current' ? 'current-password' : 'new-password'}
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              className="input mt-1"
            />
          </label>
        ))}
      </div>
      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-success' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
      <button
        onClick={() => void changePassword()}
        disabled={!current || next.length < 10 || !repeat}
        className="btn-primary text-sm"
      >
        {t('profile.changePassword')}
      </button>

      <TwoFactorSetup />
    </section>
  );
}
