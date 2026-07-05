// Field-Level-Sichtbarkeit für Personendaten – das Kernstück des
// Datenschutzkonzepts (Berechtigungsmatrix in docs/architecture.md).
//
// Diese Funktion ist bewusst PURE (keine DB, keine DI): Die Beziehung
// zwischen Betrachter und Zielperson wird vorab berechnet und
// hereingereicht. Dadurch ist die komplette Matrix mit einfachen
// Unit-Tests abdeckbar – Pflicht-Negativtests siehe person-visibility.spec.ts.
//
// Grundregel: Unsichtbare Felder FEHLEN in der Response komplett
// (kein null) – das Frontend kann so nie versehentlich "leere" sensible
// Felder rendern, und Response-Snapshots verraten nicht, was existiert.
import { GlobalRole, Person, PrivacySettings } from '@prisma/client';

export interface ViewerRelationship {
  viewerRole: GlobalRole;
  isSelf: boolean;
  // Betrachter leitet mindestens ein Team, in dem die Zielperson Mitglied ist
  isLeaderOfTarget: boolean;
  // Betrachter und Zielperson teilen mindestens ein Team
  sharesTeamWithTarget: boolean;
}

// Öffentliche Basis: sehen alle eingeloggten Mitglieder
export interface PersonPublicView {
  id: string;
  firstName: string;
  lastName: string;
  status: Person['status'];
  photoUrl?: string | null;
}

export interface PersonContactView extends PersonPublicView {
  email?: string | null;
  phone?: string | null;
  birthday?: Date | null;
}

export interface PersonFullView extends PersonContactView {
  address?: string | null;
  locale?: string;
  importNotes?: string | null;
  createdAt?: Date;
}

export type PersonView = PersonPublicView | PersonContactView | PersonFullView;

type PersonWithPrivacy = Person & { privacySettings?: PrivacySettings | null };

export function buildPersonView(
  person: PersonWithPrivacy,
  relationship: ViewerRelationship,
): PersonView {
  const privacy = person.privacySettings;

  const base: PersonPublicView = {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    status: person.status,
  };
  // Foto: instanzweit für Mitglieder sichtbar, außer die Person hat es
  // abgeschaltet. Admins/Leiter/selbst sehen es immer.
  const photoAllowed =
    relationship.viewerRole === 'ADMIN' ||
    relationship.isSelf ||
    relationship.isLeaderOfTarget ||
    (privacy?.photoVisibleToMembers ?? true);
  if (photoAllowed) {
    base.photoUrl = person.photoUrl;
  }

  // Admin und die Person selbst: alles (Notizen laufen separat über die
  // Notes-API mit eigener Berechtigungsstufe)
  if (relationship.viewerRole === 'ADMIN' || relationship.isSelf) {
    const full: PersonFullView = {
      ...base,
      email: person.email,
      phone: person.phone,
      birthday: person.birthday,
      address: person.address,
      locale: person.locale,
      createdAt: person.createdAt,
    };
    if (relationship.viewerRole === 'ADMIN') {
      full.importNotes = person.importNotes;
    }
    return full;
  }

  // Teamleiter der Zielperson: Kontaktdaten ja (braucht er für die
  // Einteilung), Adresse/Notizen nein
  if (relationship.isLeaderOfTarget) {
    return {
      ...base,
      email: person.email,
      phone: person.phone,
      birthday: person.birthday,
    } satisfies PersonContactView;
  }

  // Gemeinsames Team: nur die Kontaktdaten, die die Zielperson selbst
  // freigegeben hat (PrivacySettings, Default: nichts)
  if (relationship.sharesTeamWithTarget && privacy) {
    const view: PersonContactView = { ...base };
    if (privacy.emailVisibleToTeam) view.email = person.email;
    if (privacy.phoneVisibleToTeam) view.phone = person.phone;
    if (privacy.birthdayVisibleToTeam) view.birthday = person.birthday;
    return view;
  }

  // Fremdes Mitglied: nur Name + ggf. Foto
  return base;
}
