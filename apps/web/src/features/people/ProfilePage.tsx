import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

interface Profile {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
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

  useEffect(() => {
    void api.get<Profile>('/me').then(setProfile);
    void api.get<Privacy>('/me/privacy').then(setPrivacy);
  }, []);

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

  if (!profile || !privacy) return <p className="text-gray-500">{t('common.loading')}</p>;

  const privacyLabels: Record<keyof Privacy, string> = {
    emailVisibleToTeam: t('profile.shareEmail'),
    phoneVisibleToTeam: t('profile.sharePhone'),
    birthdayVisibleToTeam: t('profile.shareBirthday'),
    photoVisibleToMembers: t('profile.sharePhoto'),
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">
        {profile.firstName} {profile.lastName}
      </h1>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow">
        <h2 className="font-semibold">{t('profile.contactData')}</h2>
        {(['email', 'phone', 'address'] as const).map((field) => (
          <label key={field} className="block">
            <span className="text-sm text-gray-700">
              {t(`profile.${field}`)}{' '}
              <span className="text-gray-400">({t('common.optional')})</span>
            </span>
            <input
              value={profile[field] ?? ''}
              onChange={(e) => setProfile({ ...profile, [field]: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 p-2"
            />
          </label>
        ))}
        <button
          onClick={() => void saveProfile()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          {saved ? '✓' : t('common.save')}
        </button>
      </section>

      <section className="space-y-2 rounded-xl bg-white p-4 shadow">
        <h2 className="font-semibold">{t('profile.privacyTitle')}</h2>
        <p className="text-sm text-gray-500">{t('profile.privacyHint')}</p>
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

      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="font-semibold">{t('profile.dataExportTitle')}</h2>
        <p className="mb-2 text-sm text-gray-500">{t('profile.dataExportHint')}</p>
        <button
          onClick={() => void downloadExport()}
          className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-600"
        >
          {t('profile.downloadExport')}
        </button>
      </section>
    </div>
  );
}
