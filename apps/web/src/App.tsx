import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './features/auth/LoginPage';
import { SessionProvider, useSession } from './features/auth/SessionContext';

// Leitet nicht eingeloggte Nutzer zum Login um. Das ist reine UX –
// die eigentliche Zugriffskontrolle passiert serverseitig.
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const { t } = useTranslation();
  if (loading) return <p className="p-4 text-gray-500">{t('common.loading')}</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Platzhalter-Dashboard – wird mit den Feature-Modulen ausgebaut
function Dashboard() {
  const { session, logout } = useSession();
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="flex items-center justify-between border-b pb-3">
        <h1 className="text-xl font-bold">{t('common.appName')}</h1>
        <button onClick={() => void logout()} className="text-sm text-indigo-600">
          {t('auth.logout')}
        </button>
      </header>
      <p className="mt-4">
        {session?.firstName} {session?.lastName} · {session?.globalRole}
      </p>
    </main>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
