import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';

interface TotpStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

interface SetupData {
  qrDataUrl: string;
  secret: string;
  backupCodes: string[];
}

// 2FA-Karte im Profil: Status + Einrichtungs-Wizard in drei Schritten
// (QR/Secret → Backup-Codes sichern → mit Code bestätigen), dazu
// Deaktivieren per Passwort und Erneuern der Backup-Codes per TOTP-Code.
export default function TwoFactorSetup() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [step, setStep] = useState<'idle' | 'scan' | 'codes' | 'confirm'>('idle');
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [showRegen, setShowRegen] = useState(false);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const reload = useCallback(() => {
    void api.get<TotpStatus>('/auth/2fa/status').then(setStatus);
  }, []);

  useEffect(reload, [reload]);

  function fail(error: unknown) {
    const text =
      error instanceof ApiError && error.status === 401
        ? t('auth.invalidTotp')
        : t('common.error');
    setMessage({ kind: 'error', text });
  }

  async function startSetup() {
    setMessage(null);
    setSetup(await api.post<SetupData>('/auth/2fa/setup'));
    setStep('scan');
  }

  async function confirm() {
    setMessage(null);
    try {
      await api.post('/auth/2fa/verify', { code: confirmCode });
      setStep('idle');
      setSetup(null);
      setConfirmCode('');
      setMessage({ kind: 'ok', text: t('profile.twoFactorActivated') });
      reload();
    } catch (error) {
      fail(error);
    }
  }

  async function disable() {
    setMessage(null);
    try {
      await api.post('/auth/2fa/disable', { password: disablePassword });
      setShowDisable(false);
      setDisablePassword('');
      setFreshCodes(null);
      reload();
    } catch (error) {
      const text =
        error instanceof ApiError && error.status === 401
          ? t('auth.wrongPassword')
          : t('common.error');
      setMessage({ kind: 'error', text });
    }
  }

  async function regenerate() {
    setMessage(null);
    try {
      const response = await api.post<{ backupCodes: string[] }>('/auth/2fa/backup-codes', {
        code: regenCode,
      });
      setFreshCodes(response.backupCodes);
      setShowRegen(false);
      setRegenCode('');
      reload();
    } catch (error) {
      fail(error);
    }
  }

  if (!status) return null;

  const codeList = (codes: string[]) => (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-line bg-ink p-3 font-mono text-sm sm:max-w-sm">
      {codes.map((code) => (
        <span key={code}>{code}</span>
      ))}
    </div>
  );

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div>
        <h3 className="text-sm font-medium text-secondary">{t('profile.twoFactorTitle')}</h3>
        <p className="text-xs text-faint">{t('profile.twoFactorHint')}</p>
      </div>

      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-success' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      {/* Status + Aktionen */}
      {step === 'idle' && (
        <div className="space-y-3">
          <p className="text-sm">
            {status.enabled ? (
              <span className="badge badge-success">{t('profile.twoFactorEnabled')}</span>
            ) : (
              <span className="badge badge-muted">{t('profile.twoFactorDisabled')}</span>
            )}
            {status.enabled && (
              <span className="ml-2 text-xs text-muted">
                {t('profile.backupCodesRemaining', { count: status.backupCodesRemaining })}
              </span>
            )}
          </p>

          {!status.enabled && (
            <button onClick={() => void startSetup()} className="btn-primary text-sm">
              {t('profile.twoFactorSetupStart')}
            </button>
          )}

          {status.enabled && (
            <div className="space-y-3">
              {freshCodes && (
                <div className="space-y-2">
                  <p className="text-xs text-muted">{t('profile.backupCodesHint')}</p>
                  {codeList(freshCodes)}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!showRegen && (
                  <button onClick={() => setShowRegen(true)} className="btn-ghost text-sm">
                    {t('profile.backupCodesRegenerate')}
                  </button>
                )}
                {!showDisable && (
                  <button
                    onClick={() => setShowDisable(true)}
                    className="btn-ghost text-sm"
                    style={{ color: 'var(--color-danger)' }}
                  >
                    {t('profile.twoFactorDisable')}
                  </button>
                )}
              </div>

              {showRegen && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={regenCode}
                    onChange={(e) => setRegenCode(e.target.value)}
                    placeholder={t('auth.twoFactorCode')}
                    maxLength={6}
                    className="input w-32 text-sm"
                  />
                  <button
                    onClick={() => void regenerate()}
                    disabled={regenCode.length !== 6}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    {t('profile.backupCodesRegenerate')}
                  </button>
                  <button onClick={() => setShowRegen(false)} className="text-xs text-muted">
                    {t('common.cancel')}
                  </button>
                </div>
              )}

              {showDisable && (
                <div className="space-y-2">
                  <p className="text-xs text-muted">{t('profile.twoFactorDisableHint')}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      placeholder={t('auth.password')}
                      className="input w-52 text-sm"
                    />
                    <button
                      onClick={() => void disable()}
                      disabled={!disablePassword}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      {t('profile.twoFactorDisable')}
                    </button>
                    <button onClick={() => setShowDisable(false)} className="text-xs text-muted">
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Schritt 1: QR scannen oder Secret manuell eingeben */}
      {step === 'scan' && setup && (
        <div className="space-y-3">
          <p className="text-sm text-secondary">{t('profile.twoFactorScan')}</p>
          <img
            src={setup.qrDataUrl}
            alt="QR-Code"
            width={180}
            height={180}
            className="rounded-lg bg-white p-2"
          />
          <div>
            <p className="text-xs text-muted">{t('profile.twoFactorManualSecret')}</p>
            <code className="text-sm break-all text-paper">{setup.secret}</code>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep('codes')} className="btn-primary text-sm">
              {t('common.next')}
            </button>
            <button
              onClick={() => {
                setStep('idle');
                setSetup(null);
              }}
              className="text-sm text-muted"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Schritt 2: Backup-Codes sichern */}
      {step === 'codes' && setup && (
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium text-secondary">{t('profile.backupCodesTitle')}</h4>
            <p className="text-xs text-muted">{t('profile.backupCodesHint')}</p>
          </div>
          {codeList(setup.backupCodes)}
          <button onClick={() => setStep('confirm')} className="btn-primary text-sm">
            {t('profile.backupCodesSaved')}
          </button>
        </div>
      )}

      {/* Schritt 3: mit Code aus der App bestätigen */}
      {step === 'confirm' && (
        <div className="space-y-3">
          <p className="text-sm text-secondary">{t('profile.twoFactorConfirmCode')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              className="input w-32 text-center font-mono"
              autoFocus
            />
            <button
              onClick={() => void confirm()}
              disabled={confirmCode.length !== 6}
              className="btn-primary text-sm"
            >
              {t('profile.twoFactorActivate')}
            </button>
            <button
              onClick={() => {
                setStep('idle');
                setSetup(null);
              }}
              className="text-sm text-muted"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
