import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import SecuritySection from './SecuritySection';
import { api } from '../../api/client';

interface Profile {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  memberships: {
    teamId: string;
    teamName: string;
    color: string;
    role: 'LEADER' | 'DEPUTY' | 'MEMBER' | 'INTERN';
  }[];
}

interface Privacy {
  emailVisibleToTeam: boolean;
  phoneVisibleToTeam: boolean;
  birthdayVisibleToTeam: boolean;
  photoVisibleToMembers: boolean;
}

// Eigenes Profil: Kontaktdaten pflegen, Sichtbarkeit steuern (wer im
// Team sieht was), eigene Daten als JSON exportieren (DSGVO).
export default function ProfilePage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [saved, setSaved] = useState(false);
  const [icalUrl, setIcalUrl] = useState<string | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    void api.get<Profile>('/me').then(setProfile);
    void api.get<Privacy>('/me/privacy').then(setPrivacy);
  }, []);

  // Vom Avatar-Menü aus („Passwort ändern") direkt zur Sicherheits-
  // Sektion scrollen – erst, wenn die Seite fertig gerendert ist.
  useEffect(() => {
    if (hash === '#sicherheit' && profile && privacy) {
      document.getElementById('sicherheit')?.scrollIntoView({ block: 'start' });
    }
  }, [hash, profile, privacy]);

  async function saveProfile() {
    if (!profile) return;
    await api.patch('/me', {
      email: profile.email || undefined,
      phone: profile.phone || undefined,
      address: profile.address || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function togglePrivacy(key: keyof Privacy) {
    if (!privacy) return;
    const next = { ...privacy, [key]: !privacy[key] };
    setPrivacy(next);
    await api.put('/me/privacy', next);
  }

  async function downloadExport() {
    const data = await api.get<unknown>('/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'serveflow-datenexport.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!profile || !privacy) return <p className="text-muted">{t('common.loading')}</p>;

  const privacyLabels: Record<keyof Privacy, string> = {
    emailVisibleToTeam: t('profile.shareEmail'),
    phoneVisibleToTeam: t('profile.sharePhone'),
    birthdayVisibleToTeam: t('profile.shareBirthday'),
    photoVisibleToMembers: t('profile.sharePhoto'),
  };

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold tracking-tight text-paper">
        {profile.firstName} {profile.lastName}
      </h1>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold text-paper">{t('profile.contactData')}</h2>
        {(['email', 'phone', 'address'] as const).map((field) => (
          <label key={field} className="block">
            <span className="text-sm text-secondary">
              {t(`profile.${field}`)} <span className="text-faint">({t('common.optional')})</span>
            </span>
            <input
              value={profile[field] ?? ''}
              onChange={(e) => setProfile({ ...profile, [field]: e.target.value })}
              className="input mt-1"
            />
          </label>
        ))}
        <button onClick={() => void saveProfile()} className="btn-primary text-sm">
          {saved ? '✓' : t('common.save')}
        </button>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold text-paper">{t('profile.myTeams')}</h2>
        {profile.memberships.length === 0 ? (
          <p className="mt-2 text-sm text-faint">{t('people.noTeams')}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {profile.memberships.map((membership) => (
              <li key={membership.teamId} className="flex items-center gap-2 text-sm">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: membership.color }}
                />
                <span className="text-paper">{membership.teamName}</span>
                <span className="badge badge-muted">{t(`teams.roles.${membership.role}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-paper">{t('profile.privacyTitle')}</h2>
        <p className="text-sm text-muted">{t('profile.privacyHint')}</p>
        {(Object.keys(privacyLabels) as (keyof Privacy)[]).map((key) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={privacy[key]}
              onChange={() => void togglePrivacy(key)}
            />
            <span className="text-sm">{privacyLabels[key]}</span>
          </label>
        ))}
      </section>

      <SecuritySection />

      <section className="card p-4">
        <h2 className="font-semibold text-paper">{t('profile.icalTitle')}</h2>
        <p className="mb-2 text-sm text-muted">{t('profile.icalHint')}</p>
        {icalUrl ? (
          <input
            readOnly
            value={icalUrl}
            onFocus={(e) => e.target.select()}
            className="input text-sm"
          />
        ) : (
          <button
            onClick={() =>
              void api
                .post<{ url: string }>('/me/ical-token')
                .then((response) => setIcalUrl(response.url))
            }
            className="btn-ghost text-sm"
          >
            {t('profile.icalGenerate')}
          </button>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-semibold text-paper">{t('profile.dataExportTitle')}</h2>
        <p className="mb-2 text-sm text-muted">{t('profile.dataExportHint')}</p>
        <button onClick={() => void downloadExport()} className="btn-ghost text-sm">
          {t('profile.downloadExport')}
        </button>
      </section>
    </div>
  );
}
