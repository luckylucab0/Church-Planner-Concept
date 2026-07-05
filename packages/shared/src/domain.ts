// Geteilte Domänen-Konstanten. Die API ist die Quelle der Wahrheit (Prisma-Enums);
// diese String-Literale müssen mit apps/api/prisma/schema.prisma übereinstimmen.
// Sie sind hier dupliziert, damit das Frontend keinen Prisma-Client braucht.

export const GLOBAL_ROLES = ['ADMIN', 'MEMBER'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const ASSIGNMENT_STATUSES = ['REQUESTED', 'ACCEPTED', 'DECLINED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const SKILL_LEVELS = ['BEGINNER', 'SOLID', 'EXPERT'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const EVENT_STATUSES = ['PLANNED', 'PUBLISHED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const NOTE_KINDS = ['GENERAL', 'PASTORAL'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const SUPPORTED_LOCALES = ['de', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
