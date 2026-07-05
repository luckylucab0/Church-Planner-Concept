import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useSession } from '../features/auth/SessionContext';

// App-Shell mit Mobile-First-Navigation: unten auf dem Handy erreichbar,
// oben auf größeren Screens.
export default function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { session, logout } = useSession();

  const links = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/plans', label: t('nav.plans') },
    { to: '/people', label: t('nav.people') },
    { to: '/teams', label: t('nav.teams') },
    { to: '/availability', label: t('nav.availability') },
    { to: '/profile', label: t('nav.profile') },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-16 sm:pb-0">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between p-3">
          <span className="font-bold text-indigo-700">{t('common.appName')}</span>
          <nav className="hidden gap-4 sm:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `text-sm ${isActive ? 'font-semibold text-indigo-700' : 'text-gray-600'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <button onClick={() => void logout()} className="text-sm text-gray-500">
            {t('auth.logout')} ({session?.firstName})
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-4">{children}</main>

      {/* Mobile: Bottom-Navigation */}
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t bg-white p-2 sm:hidden">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `px-3 py-1 text-sm ${isActive ? 'font-semibold text-indigo-700' : 'text-gray-600'}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
