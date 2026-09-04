// Pro-Request-Kontext für Werte, die das Audit-Log braucht, die aber sonst
// durch jede Service-Signatur gereicht werden müssten.
//
// Warum überhaupt: Das Audit-Log ist laut docs/security.md die zentrale
// Maßnahme gegen ein kompromittiertes Konto – dafür ist die Herkunft einer
// Aktion (die Client-IP) der entscheidende Hinweis. Der AuditService wird
// aber aus ~60 Stellen in 13 Services aufgerufen, die den Request nicht
// kennen.
//
// Warum nicht anders gelöst:
//   - REQUEST-Scope für den AuditService würde über AuditModule (@Global)
//     auf praktisch den gesamten Provider-Graphen kaskadieren.
//   - Die IP durch alle Signaturen zu reichen, wären ~60 Berührungspunkte,
//     die bei jedem neuen Aufruf wieder vergessen werden können – und die
//     tokenbasierten Routen (Einladung, Passwort-Reset, Vertretung) haben
//     gar keinen AuthUser, an den man sie hängen könnte.
//
// Bewusst Nodes eingebautes AsyncLocalStorage statt nestjs-cls: Für einen
// einzigen Wert lohnt keine zusätzliche Abhängigkeit.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Client-IP des laufenden Requests (bei trustProxy aus X-Forwarded-For). */
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

// Spannt den Kontext für die Dauer von `fn` und aller darin gestarteten
// asynchronen Fortsetzungen auf.
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

// Liefert die IP des laufenden Requests – oder undefined, wenn der Aufruf
// außerhalb eines Requests passiert (z. B. aus einem Hintergrund-Job).
export function currentRequestIp(): string | undefined {
  return storage.getStore()?.ip;
}
