import { GlobalRole } from '@prisma/client';

// Der authentifizierte Nutzer, wie ihn Guards an Request und Controller
// weiterreichen. Bewusst schlank – alles Weitere holen sich Services
// gezielt aus der DB.
export interface AuthUser {
  accountId: string;
  personId: string;
  globalRole: GlobalRole;
}

// Fastify-Request um die Auth-Daten erweitert.
// unsignCookie stammt aus @fastify/cookie und prüft die Signatur des
// Session-Cookies (siehe SessionAuthGuard).
export interface AuthenticatedRequest {
  user?: AuthUser;
  sessionToken?: string;
  cookies: Record<string, string | undefined>;
  unsignCookie(value: string): { valid: boolean; renew: boolean; value: string | null };
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  method: string;
}
