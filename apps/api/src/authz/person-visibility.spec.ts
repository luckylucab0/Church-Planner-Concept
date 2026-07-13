// Pflicht-Negativtests der Berechtigungsmatrix (Rolle × Feld).
// Wichtigste Assertion-Form: `expect(view).not.toHaveProperty('email')` –
// unsichtbare Felder müssen FEHLEN, nicht nur null sein.
import { Person, PrivacySettings } from '@prisma/client';
import { buildPersonView, ViewerRelationship } from './person-visibility';

function makePerson(privacy?: Partial<PrivacySettings>): Person & {
  privacySettings: PrivacySettings | null;
} {
  return {
    id: 'p-1',
    firstName: 'Anna',
    lastName: 'Keller',
    email: 'anna@example.org',
    phone: '+41 79 000 00 00',
    birthday: new Date('1990-05-01'),
    address: 'Musterweg 1, 8000 Zürich',
    photoUrl: 'https://example.org/anna.jpg',
    status: 'ACTIVE',
    locale: 'de',
    importNotes: 'aus Elvanto importiert',
    anonymizedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    privacySettings: {
      personId: 'p-1',
      emailVisibleToTeam: false,
      phoneVisibleToTeam: false,
      birthdayVisibleToTeam: false,
      photoVisibleToMembers: true,
      ...privacy,
    },
  };
}

const rel = (overrides: Partial<ViewerRelationship>): ViewerRelationship => ({
  viewerRole: 'MEMBER',
  isSelf: false,
  canViewContactsOfTarget: false,
  canNotesOnTarget: false,
  sharesTeamWithTarget: false,
  ...overrides,
});

describe('buildPersonView – Berechtigungsmatrix', () => {
  describe('Mitglied ohne Beziehung (neugieriges Mitglied)', () => {
    const view = buildPersonView(makePerson(), rel({}));

    it('sieht nur Name, Status und Foto', () => {
      expect(view).toEqual({
        id: 'p-1',
        firstName: 'Anna',
        lastName: 'Keller',
        status: 'ACTIVE',
        photoUrl: 'https://example.org/anna.jpg',
      });
    });

    it('bekommt keine Kontaktdaten – Felder fehlen komplett', () => {
      expect(view).not.toHaveProperty('email');
      expect(view).not.toHaveProperty('phone');
      expect(view).not.toHaveProperty('birthday');
      expect(view).not.toHaveProperty('address');
      expect(view).not.toHaveProperty('importNotes');
    });
  });

  it('respektiert abgeschaltetes Foto (photoVisibleToMembers=false)', () => {
    const view = buildPersonView(makePerson({ photoVisibleToMembers: false }), rel({}));
    expect(view).not.toHaveProperty('photoUrl');
  });

  describe('Mitglied im gemeinsamen Team', () => {
    it('sieht nur die von der Person freigegebenen Kontaktdaten', () => {
      const person = makePerson({ emailVisibleToTeam: true, phoneVisibleToTeam: false });
      const view = buildPersonView(person, rel({ sharesTeamWithTarget: true }));
      expect(view).toHaveProperty('email', 'anna@example.org');
      expect(view).not.toHaveProperty('phone');
      expect(view).not.toHaveProperty('address');
    });

    it('sieht ohne Freigaben gar keine Kontaktdaten', () => {
      const view = buildPersonView(makePerson(), rel({ sharesTeamWithTarget: true }));
      expect(view).not.toHaveProperty('email');
      expect(view).not.toHaveProperty('phone');
      expect(view).not.toHaveProperty('birthday');
    });
  });

  describe('Teamleiter der Zielperson (Capability VIEW_CONTACTS)', () => {
    const view = buildPersonView(makePerson(), rel({ canViewContactsOfTarget: true }));

    it('sieht Kontaktdaten (auch ohne Freigabe – Einteilungszweck)', () => {
      expect(view).toHaveProperty('email', 'anna@example.org');
      expect(view).toHaveProperty('phone');
      expect(view).toHaveProperty('birthday');
    });

    it('sieht KEINE Adresse und keine Import-Notizen', () => {
      expect(view).not.toHaveProperty('address');
      expect(view).not.toHaveProperty('importNotes');
    });
  });

  describe('Teamleiter eines FREMDEN Teams (kompromittiertes Leiter-Konto)', () => {
    it('sieht nur die Basis wie jedes Mitglied', () => {
      // canViewContactsOfTarget=false: die Zielperson ist NICHT in seinem Team
      const view = buildPersonView(makePerson(), rel({ canViewContactsOfTarget: false }));
      expect(view).not.toHaveProperty('email');
      expect(view).not.toHaveProperty('phone');
    });
  });

  it('Person selbst sieht alle eigenen Daten inkl. Adresse', () => {
    const view = buildPersonView(makePerson(), rel({ isSelf: true }));
    expect(view).toHaveProperty('email');
    expect(view).toHaveProperty('address');
    // aber keine Import-Notizen (Admin-Werkzeug)
    expect(view).not.toHaveProperty('importNotes');
  });

  it('Admin sieht alles', () => {
    const view = buildPersonView(makePerson(), rel({ viewerRole: 'ADMIN' }));
    expect(view).toHaveProperty('email');
    expect(view).toHaveProperty('address');
    expect(view).toHaveProperty('importNotes');
  });
});
