// English translations. Must mirror the key structure of de.ts –
// the Messages type in index.ts enforces this at compile time.
export const en = {
  common: {
    appName: 'ServeFlow',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    search: 'Search',
    loading: 'Loading…',
    yes: 'Yes',
    no: 'No',
    optional: 'optional',
    error: 'Something went wrong.',
  },
  auth: {
    login: 'Sign in',
    logout: 'Sign out',
    email: 'Email',
    password: 'Password',
    invalidCredentials: 'Invalid email or password.',
    twoFactorCode: '2FA code',
    forgotPassword: 'Forgot password?',
  },
  nav: {
    dashboard: 'Dashboard',
    plans: 'Service plans',
    people: 'People',
    teams: 'Teams',
    availability: 'Unavailability',
    profile: 'Profile',
    admin: 'Administration',
  },
  assignments: {
    requested: 'requested',
    accepted: 'accepted',
    declined: 'declined',
    accept: 'Accept',
    decline: 'Decline',
    myAssignments: 'My assignments',
  },
  mail: {
    assignedSubject: 'You are scheduled: {{eventTitle}} on {{date}}',
    assignedBody:
      'Hi {{firstName}},\n\nyou have been scheduled for {{position}} at "{{eventTitle}}" on {{date}}.\n\nAccept: {{acceptUrl}}\nDecline: {{declineUrl}}\n\nThank you for serving!',
    reminderSubject: 'Reminder: {{eventTitle}} on {{date}}',
    declinedAlertSubject: 'Declined: {{personName}} for {{position}} on {{date}}',
  },
} as const;
