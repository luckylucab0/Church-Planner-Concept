import { GlobalRole } from '@prisma/client';

// Der authentifizierte Nutzer, wie ihn Guards an Request und Controller
// weiterreichen. Bewusst schlank – alles Weitere holen sich Services
// gezielt aus der DB.
export interface AuthUser {
  accountId: string;
  personId: string;
  globalRole: GlobalRole;
}

// Fastify-Request um die Auth-Daten erweitert
export interface AuthenticatedRequest {
  user?: AuthUser;
  sessionToken?: string;
  cookies: Record<string, string | undefined>;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  method: string;
}
