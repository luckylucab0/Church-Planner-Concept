// Session-State der App: beim Start einmal /auth/session abfragen,
// danach halten Login/Logout den State aktuell. Kein globaler
// State-Manager nötig – die Session ist der einzige App-weite Zustand.
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import i18n from '../../i18n';
import { api, ApiError, SessionInfo } from '../../api/client';

interface SessionState {
  session: SessionInfo | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  setLocale: (locale: string) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<SessionInfo>('/auth/session')
      .then(setSession)
      .catch((error: unknown) => {
        // 401 = schlicht nicht eingeloggt, kein Fehlerzustand
        if (!(error instanceof ApiError && error.status === 401)) console.error(error);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const info = await api.post<SessionInfo>('/auth/login', { email, password, totpCode });
    setSession(info);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setSession(null);
  }, []);

  // Die im Profil gewählte Sprache schlägt auf die Oberfläche durch – ohne
  // sie wäre `Person.locale` nur die Sprache der E-Mails.
  useEffect(() => {
    if (session?.locale && session.locale !== i18n.language) {
      void i18n.changeLanguage(session.locale);
    }
  }, [session?.locale]);

  const setLocale = useCallback((locale: string) => {
    setSession((current) => (current ? { ...current, locale } : current));
  }, []);

  const value = useMemo(
    () => ({ session, loading, login, logout, setLocale }),
    [session, loading, login, logout, setLocale],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession außerhalb von SessionProvider');
  return context;
}
