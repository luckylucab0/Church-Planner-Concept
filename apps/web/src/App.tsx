import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './features/auth/LoginPage';
import { SessionProvider, useSession } from './features/auth/SessionContext';
import PeopleListPage from './features/people/PeopleListPage';
import ProfilePage from './features/people/ProfilePage';
import EventDetailPage from './features/plans/EventDetailPage';
import PlansPage from './features/plans/PlansPage';
import TeamsPage from './features/teams/TeamsPage';

// Leitet nicht eingeloggte Nutzer zum Login um. Das ist reine UX –
// die eigentliche Zugriffskontrolle passiert serverseitig.
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const { t } = useTranslation();
  if (loading) return <p className="p-4 text-gray-500">{t('common.loading')}</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

// Platzhalter – wird mit den Plan-Modulen ausgebaut
function Dashboard() {
  const { session } = useSession();
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-xl font-bold">{t('nav.dashboard')}</h1>
      <p className="mt-2 text-gray-600">
        {session?.firstName} {session?.lastName} · {session?.globalRole}
      </p>
    </div>
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
        <Route
          path="/people"
          element={
            <RequireAuth>
              <PeopleListPage />
            </RequireAuth>
          }
        />
        <Route
          path="/plans"
          element={
            <RequireAuth>
              <PlansPage />
            </RequireAuth>
          }
        />
        <Route
          path="/plans/:eventId"
          element={
            <RequireAuth>
              <EventDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/teams"
          element={
            <RequireAuth>
              <TeamsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
