import { ComponentType, ReactNode, SVGProps, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import {
  IconAvailability,
  IconCalendar,
  IconDashboard,
  IconImport,
  IconKey,
  IconLogout,
  IconMore,
  IconMusic,
  IconPeople,
  IconProfile,
  IconTeams,
} from './icons';
import { useSession } from '../features/auth/SessionContext';

interface NavItem {
  to: string;
  labelKey: string;
  en: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  adminOnly?: boolean;
  primary?: boolean; // erscheint in der mobilen Tab-Bar (max. 4 + „Mehr")
}

// Ein Nav-Modell für Desktop-Sidebar und Mobile-Tab-Bar. `primary`
// markiert die vier wichtigsten Ziele für die Bottom-Tab-Bar; der Rest
// landet unter „Mehr".
const NAV: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', en: 'Dashboard', icon: IconDashboard, primary: true },
  { to: '/plans', labelKey: 'nav.plans', en: 'Schedule', icon: IconCalendar, primary: true },
  { to: '/teams', labelKey: 'nav.teams', en: 'Teams', icon: IconTeams, primary: true },
  { to: '/songs', labelKey: 'songs.title', en: 'Songs', icon: IconMusic, primary: true },
  { to: '/people', labelKey: 'nav.people', en: 'People', icon: IconPeople },
  { to: '/availability', labelKey: 'nav.availability', en: 'Availability', icon: IconAvailability },
  { to: '/profile', labelKey: 'nav.profile', en: 'Profile', icon: IconProfile },
  {
    to: '/admin/import',
    labelKey: 'import.title',
    en: 'Import',
    icon: IconImport,
    adminOnly: true,
  },
];

function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-avatar font-semibold text-secondary"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}

// App-Shell mit responsivem Navigationsmodell:
// ≥1024px feste Sidebar links, darunter Bottom-Tab-Bar + „Mehr"-Sheet.
export default function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Avatar-Menü: eigenes Profil, Passwort ändern, Abmelden – auf dem
  // Desktop als Popover über dem User-Chip, mobil als Bottom-Sheet.
  const userMenuItems = [
    {
      key: 'profile',
      label: t('nav.myProfile'),
      icon: IconProfile,
      action: () => navigate('/profile'),
    },
    {
      key: 'password',
      label: t('profile.changePassword'),
      icon: IconKey,
      action: () => navigate('/profile#sicherheit'),
    },
    {
      key: 'logout',
      label: t('auth.logout'),
      icon: IconLogout,
      action: () => void logout(),
    },
  ];

  function runMenuItem(action: () => void) {
    setUserMenuOpen(false);
    window.scrollTo(0, 0);
    action();
  }

  const isAdmin = session?.globalRole === 'ADMIN';
  const visible = NAV.filter((item) => !item.adminOnly || isAdmin);
  const primary = visible.filter((item) => item.primary);
  const overflow = visible.filter((item) => !item.primary);
  const fullName = `${session?.firstName ?? ''} ${session?.lastName ?? ''}`.trim();

  const activeClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors',
      isActive
        ? 'bg-surface-hover font-semibold text-gold'
        : 'text-secondary hover:bg-surface hover:text-paper',
    ].join(' ');

  return (
    <div className="min-h-screen bg-ink text-paper lg:flex">
      {/* Desktop-Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-ink-deep p-4 lg:flex print:hidden">
        <div className="px-2 py-3">
          <Logo iconSize={24} wordmarkSize={17} />
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => window.scrollTo(0, 0)}
              className={activeClass}
            >
              <item.icon className="shrink-0" />
              <span className="flex flex-col leading-tight">
                <span>{t(item.labelKey)}</span>
                <span className="text-[11px] font-normal text-faint">{item.en}</span>
              </span>
            </NavLink>
          ))}
        </nav>
        {/* User-Chip unten: öffnet das Avatar-Menü */}
        <div className="relative mt-auto">
          {userMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 z-40 mb-2 card p-1.5 shadow-lg">
              {userMenuItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => runMenuItem(item.action)}
                  className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm text-secondary transition-colors hover:bg-ink hover:text-paper"
                >
                  <item.icon className="shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setUserMenuOpen((open) => !open)}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left transition-colors hover:border-line-strong"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
          >
            <Avatar name={fullName || 'S F'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-paper">{fullName}</p>
              <p className="truncate text-xs text-muted">{isAdmin ? 'Admin' : t('nav.profile')}</p>
            </div>
          </button>
        </div>
      </aside>

      {/* Klick daneben schließt das Desktop-Avatar-Menü */}
      {userMenuOpen && (
        <div className="fixed inset-0 z-30 hidden lg:block" onClick={() => setUserMenuOpen(false)} />
      )}

      {/* Mobile-Top-Bar */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-ink-deep px-4 lg:hidden print:hidden">
        <Logo iconSize={22} wordmarkSize={16} />
        <button
          onClick={() => setUserMenuOpen(true)}
          aria-haspopup="menu"
          aria-label={t('nav.myProfile')}
        >
          <Avatar name={fullName || 'S F'} />
        </button>
      </header>

      {/* Avatar-Menü mobil: Bottom-Sheet wie das „Mehr"-Sheet */}
      {userMenuOpen && (
        <div
          className="fixed inset-0 z-30 flex flex-col justify-end bg-black/60 lg:hidden"
          onClick={() => setUserMenuOpen(false)}
        >
          <div
            className="rounded-t-2xl border-t border-line bg-surface p-4"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            <div className="mb-3 flex items-center gap-3 px-1">
              <Avatar name={fullName || 'S F'} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-paper">{fullName}</p>
                <p className="truncate text-xs text-muted">{isAdmin ? 'Admin' : t('nav.profile')}</p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {userMenuItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => runMenuItem(item.action)}
                  className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm text-secondary transition-colors hover:bg-ink hover:text-paper"
                >
                  <item.icon className="shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hauptinhalt */}
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-24 sm:p-6 lg:p-8 lg:pb-8">
        {children}
      </main>

      {/* Mobile-Bottom-Tab-Bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-ink-deep px-1 pt-1 lg:hidden print:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            // Auch beim Tippen auf den bereits aktiven Tab nach oben
            // (ohne Routenwechsel greift ScrollToTop sonst nicht)
            onClick={() => window.scrollTo(0, 0)}
            className={({ isActive }) =>
              [
                'flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px]',
                isActive ? 'font-semibold text-gold' : 'text-muted',
              ].join(' ')
            }
          >
            <item.icon />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] text-muted"
        >
          <IconMore />
          <span>{t('nav.more')}</span>
        </button>
      </nav>

      {/* „Mehr"-Sheet (Overflow-Navigation + Logout) */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-30 flex flex-col justify-end bg-black/60 lg:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="rounded-t-2xl border-t border-line bg-surface p-4"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            <div className="flex flex-col gap-1">
              {overflow.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => {
                    setMoreOpen(false);
                    window.scrollTo(0, 0);
                  }}
                  className={activeClass}
                >
                  <item.icon className="shrink-0" />
                  <span>{t(item.labelKey)}</span>
                </NavLink>
              ))}
              <button
                onClick={() => void logout()}
                className="mt-1 flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm text-secondary transition-colors hover:bg-ink hover:text-paper"
              >
                <IconLogout className="shrink-0" />
                <span>{t('auth.logout')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
