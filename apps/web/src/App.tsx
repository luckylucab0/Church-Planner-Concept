import { ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './features/auth/LoginPage';
import AvailabilityPage from './features/availability/AvailabilityPage';
import ImportPage from './features/import/ImportPage';
import { SessionProvider, useSession } from './features/auth/SessionContext';
import PeopleListPage from './features/people/PeopleListPage';
import ProfilePage from './features/people/ProfilePage';
import EventDetailPage from './features/plans/EventDetailPage';
import MyAssignments from './features/plans/MyAssignments';
import OpenSignups from './features/plans/OpenSignups';
import PlansPage from './features/plans/PlansPage';
import ReplacementPage from './features/respond/ReplacementPage';
import RespondPage from './features/respond/RespondPage';
import SongsPage from './features/songs/SongsPage';
import TeamsPage from './features/teams/TeamsPage';

// Jede Seite startet oben: Browser-Scroll-Restauration aus (sonst landet
// ein Reload mitten auf der Seite) und bei jedem Routenwechsel nach oben.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.history.scrollRestoration = 'manual';
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// Leitet nicht eingeloggte Nutzer zum Login um. Das ist reine UX –
// die eigentliche Zugriffskontrolle passiert serverseitig.
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const { t } = useTranslation();
  if (loading) return <p className="p-4 text-muted">{t('common.loading')}</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function Dashboard() {
  const { session } = useSession();
  const { t } = useTranslation();
  // Nach einer Selbst-Eintragung "Meine Dienste" neu laden (remount)
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-paper">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-sm text-muted">
          {session?.firstName} {session?.lastName}
        </p>
      </div>
      <MyAssignments key={refresh} />
      <OpenSignups onJoined={() => setRefresh((n) => n + 1)} />
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Öffentlich: Zusage/Absage + Vertretungs-Übernahme per Mail-Link */}
        <Route path="/respond/:token" element={<RespondPage />} />
        <Route path="/replacement/:token" element={<ReplacementPage />} />
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
          path="/songs"
          element={
            <RequireAuth>
              <SongsPage />
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
          path="/availability"
          element={
            <RequireAuth>
              <AvailabilityPage />
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
        <Route
          path="/admin/import"
          element={
            <RequireAuth>
              <ImportPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
