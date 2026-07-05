import { de } from './de';
import { en } from './en';

// `Messages` leitet sich aus dem deutschen Original ab – fehlt in en.ts ein
// Key oder hat er die falsche Struktur, schlägt der Typecheck fehl. So bleiben
// beide Sprachen garantiert synchron, ohne Runtime-Overhead.
type DeepStringRecord = { [key: string]: string | DeepStringRecord };
type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Messages = Shape<typeof de>;

const _enCheck: Messages = en;
void _enCheck;

export const messages: Record<'de' | 'en', Messages> = { de, en };
export { de, en };

/**
 * Minimaler Template-Interpolator für Mail-Texte:
 * interpolate('Hallo {{name}}', { name: 'Anna' }) → 'Hallo Anna'.
 * Bewusst kein Handlebars o. Ä. – keine Logik in Templates, keine
 * Injection-Fläche (Werte werden als Plain Text eingesetzt).
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export type { DeepStringRecord };
