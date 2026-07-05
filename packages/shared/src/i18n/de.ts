// Deutsche Übersetzungen (Default-Sprache).
// Struktur: ein Namespace pro Feature. Keys werden von Web-UI UND
// API-Mail-Templates genutzt – deshalb liegen sie im Shared-Paket.
export const de = {
  common: {
    appName: 'ServeFlow',
    save: 'Speichern',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    search: 'Suchen',
    loading: 'Lädt…',
    yes: 'Ja',
    no: 'Nein',
    optional: 'optional',
    error: 'Es ist ein Fehler aufgetreten.',
  },
  auth: {
    login: 'Anmelden',
    logout: 'Abmelden',
    email: 'E-Mail',
    password: 'Passwort',
    invalidCredentials: 'E-Mail oder Passwort falsch.',
    twoFactorCode: '2FA-Code',
    forgotPassword: 'Passwort vergessen?',
  },
  nav: {
    dashboard: 'Übersicht',
    plans: 'Dienstpläne',
    people: 'Personen',
    teams: 'Teams',
    availability: 'Abwesenheiten',
    profile: 'Profil',
    admin: 'Administration',
  },
  assignments: {
    requested: 'angefragt',
    accepted: 'zugesagt',
    declined: 'abgesagt',
    accept: 'Zusagen',
    decline: 'Absagen',
    myAssignments: 'Meine Dienste',
  },
  teams: {
    members: 'Mitglieder',
    positions: 'Positionen',
    leader: 'Leitung',
  },
  profile: {
    contactData: 'Kontaktdaten',
    email: 'E-Mail',
    phone: 'Telefon',
    address: 'Adresse',
    privacyTitle: 'Sichtbarkeit meiner Daten',
    privacyHint:
      'Du bestimmst, welche deiner Kontaktdaten Mitglieder deiner Teams sehen. Teamleitende deiner Teams sehen deine Kontaktdaten immer, Admins alles.',
    shareEmail: 'E-Mail für Teammitglieder sichtbar',
    sharePhone: 'Telefon für Teammitglieder sichtbar',
    shareBirthday: 'Geburtstag für Teammitglieder sichtbar',
    sharePhoto: 'Foto für alle Mitglieder sichtbar',
    dataExportTitle: 'Meine Daten',
    dataExportHint: 'Lade alle über dich gespeicherten Daten als JSON herunter (DSGVO/DSG).',
    downloadExport: 'Datenexport herunterladen',
  },
  mail: {
    assignedSubject: 'Du bist eingeteilt: {{eventTitle}} am {{date}}',
    assignedBody:
      'Hallo {{firstName}},\n\ndu wurdest für {{position}} bei „{{eventTitle}}" am {{date}} eingeteilt.\n\nZusagen: {{acceptUrl}}\nAbsagen: {{declineUrl}}\n\nDanke für deinen Dienst!',
    reminderSubject: 'Erinnerung: {{eventTitle}} am {{date}}',
    declinedAlertSubject: 'Absage: {{personName}} für {{position}} am {{date}}',
  },
} as const;
