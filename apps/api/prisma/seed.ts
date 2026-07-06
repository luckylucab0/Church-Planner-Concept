// Seed-Skript: realistische Demo-Daten für lokale Entwicklung und Demos.
// 1 Gemeinde, 30 Personen, 4 Teams, 8 Termine (nächste 8 Sonntage).
//
// Ausführen:  pnpm --filter @serveflow/api prisma:seed
// ACHTUNG: löscht vorhandene Daten – nur für dev-Datenbanken gedacht.
import { PrismaClient, SkillLevel } from '@prisma/client';
import * as argon2 from 'argon2';
import { RRule } from 'rrule';

const prisma = new PrismaClient();

// 30 fiktive Personen. example.org ist per RFC 2606 für Beispiele
// reserviert – niemand bekommt versehentlich echte Mails.
const PEOPLE: Array<[string, string]> = [
  ['Anna', 'Keller'],
  ['Ben', 'Schmid'],
  ['Clara', 'Meier'],
  ['David', 'Huber'],
  ['Elena', 'Weber'],
  ['Fabian', 'Baumann'],
  ['Gabriela', 'Frei'],
  ['Hannes', 'Zimmermann'],
  ['Ines', 'Graf'],
  ['Jonas', 'Steiner'],
  ['Katrin', 'Brunner'],
  ['Lukas', 'Gerber'],
  ['Mia', 'Widmer'],
  ['Noah', 'Schneider'],
  ['Olivia', 'Moser'],
  ['Pascal', 'Fischer'],
  ['Rahel', 'Kunz'],
  ['Simon', 'Wyss'],
  ['Tabea', 'Roth'],
  ['Urs', 'Bachmann'],
  ['Vera', 'Hofer'],
  ['Werner', 'Lang'],
  ['Xenia', 'Marti'],
  ['Yannick', 'Suter'],
  ['Zoe', 'Bieri'],
  ['Adrian', 'Koch'],
  ['Beatrice', 'Egli'],
  ['Cyrill', 'Stalder'],
  ['Debora', 'Vogel'],
  ['Emil', 'Tanner'],
];

const TEAMS: Record<string, string[]> = {
  Worship: ['Gitarre', 'Drums', 'Vocals', 'Keys', 'Bass'],
  Technik: ['Ton', 'Licht', 'Beamer', 'Livestream'],
  Kinderdienst: ['Leitung', 'Mitarbeit'],
  Kaffee: ['Theke', 'Aufbau'],
};

async function main(): Promise<void> {
  console.log('Seed: lösche vorhandene Daten…');
  // Audit-Log ist per DB-Trigger append-only (DELETE verboten) –
  // TRUNCATE umgeht Row-Trigger und ist im dev-Seed legitim
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog" RESTART IDENTITY');
  // Reihenfolge egal dank ON DELETE CASCADE – nur Wurzel-Entitäten löschen
  await prisma.importJob.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.song.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.event.deleteMany();
  await prisma.serviceType.deleteMany();
  await prisma.team.deleteMany();
  await prisma.person.deleteMany();

  console.log('Seed: lege 30 Personen an…');
  const people = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const [firstName, lastName] = PEOPLE[i];
    const person = await prisma.person.create({
      data: {
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.org`,
        // Nur ein Teil der Personen hat Telefon/Geburtstag hinterlegt –
        // realistisch und demonstriert optionale Felder
        phone:
          i % 3 === 0 ? `+41 79 ${String(1000000 + i * 111).slice(0, 3)} ${i}0 ${i}${i}` : null,
        birthday: i % 4 === 0 ? new Date(1970 + i, i % 12, (i % 27) + 1) : null,
        privacySettings: {
          create: {
            // Die Hälfte gibt ihre E-Mail für Teammitglieder frei
            emailVisibleToTeam: i % 2 === 0,
            phoneVisibleToTeam: i % 6 === 0,
            photoVisibleToMembers: true,
          },
        },
      },
    });
    people.push(person);
  }

  console.log('Seed: lege Login-Konten an (admin / teamleiter / mitglied)…');
  // Bekannte Test-Logins für die drei Rollen; Passwörter stehen in der README
  const hash = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
  await prisma.person.update({
    where: { id: people[0].id },
    data: { email: 'admin@example.org' },
  });
  await prisma.userAccount.create({
    data: {
      personId: people[0].id,
      passwordHash: await hash('admin1234!'),
      globalRole: 'ADMIN',
    },
  });
  await prisma.person.update({
    where: { id: people[1].id },
    data: { email: 'leiter@example.org' },
  });
  await prisma.userAccount.create({
    data: { personId: people[1].id, passwordHash: await hash('leiter1234!') },
  });
  await prisma.person.update({
    where: { id: people[2].id },
    data: { email: 'mitglied@example.org' },
  });
  await prisma.userAccount.create({
    data: { personId: people[2].id, passwordHash: await hash('mitglied1234!') },
  });

  console.log('Seed: lege 4 Teams mit Positionen an…');
  const teamColors: Record<string, string> = {
    Worship: '#8b5cf6',
    Technik: '#0ea5e9',
    Kinderdienst: '#f59e0b',
    Kaffee: '#78716c',
  };
  const teams: Record<string, { id: string; positionIds: string[] }> = {};
  for (const [teamName, positions] of Object.entries(TEAMS)) {
    const team = await prisma.team.create({
      data: {
        name: teamName,
        color: teamColors[teamName],
        positions: { create: positions.map((name) => ({ name })) },
      },
      include: { positions: true },
    });
    teams[teamName] = { id: team.id, positionIds: team.positions.map((p) => p.id) };
  }

  console.log('Seed: verteile Personen auf Teams (mit Skills)…');
  const teamNames = Object.keys(TEAMS);
  const skillLevels: SkillLevel[] = ['BEGINNER', 'SOLID', 'EXPERT'];
  for (let i = 0; i < people.length; i++) {
    // Jede Person in 1–2 Teams; Person 1 (leiter@) leitet Worship
    const primaryTeam = teamNames[i % teamNames.length];
    const secondaryTeam = i % 3 === 0 ? teamNames[(i + 2) % teamNames.length] : null;
    for (const teamName of [primaryTeam, secondaryTeam]) {
      if (!teamName) continue;
      const team = teams[teamName];
      await prisma.teamMembership.create({
        data: {
          teamId: team.id,
          personId: people[i].id,
          isLeader: i === 1 && teamName === 'Worship',
        },
      });
      // 1–2 Positionen pro Team-Mitgliedschaft
      const posIds = [team.positionIds[i % team.positionIds.length]];
      if (i % 2 === 0 && team.positionIds.length > 1) {
        posIds.push(team.positionIds[(i + 1) % team.positionIds.length]);
      }
      for (const positionId of new Set(posIds)) {
        await prisma.positionSkill.create({
          data: { positionId, personId: people[i].id, skillLevel: skillLevels[i % 3] },
        });
      }
    }
  }
  // Sicherstellen, dass leiter@ wirklich im Worship-Team Leiter ist
  await prisma.teamMembership.upsert({
    where: { teamId_personId: { teamId: teams.Worship.id, personId: people[1].id } },
    create: { teamId: teams.Worship.id, personId: people[1].id, isLeader: true },
    update: { isLeader: true },
  });

  console.log('Seed: Gottesdienst-Typ + 8 Termine (nächste Sonntage)…');
  const serviceType = await prisma.serviceType.create({
    data: {
      name: 'Gottesdienst',
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startTime: '10:00',
      durationMinutes: 90,
      location: 'Hauptsaal',
      positionTemplate: {
        create: [
          // Worship: 1x Gitarre, 1x Drums, 2x Vocals
          { positionId: teams.Worship.positionIds[0], requiredCount: 1 },
          { positionId: teams.Worship.positionIds[1], requiredCount: 1 },
          { positionId: teams.Worship.positionIds[2], requiredCount: 2 },
          // Technik: 1x Ton, 1x Beamer
          { positionId: teams.Technik.positionIds[0], requiredCount: 1 },
          { positionId: teams.Technik.positionIds[2], requiredCount: 1 },
          // Kinderdienst: 1x Leitung, 2x Mitarbeit
          { positionId: teams.Kinderdienst.positionIds[0], requiredCount: 1 },
          { positionId: teams.Kinderdienst.positionIds[1], requiredCount: 2 },
          // Kaffee: 2x Theke
          { positionId: teams.Kaffee.positionIds[0], requiredCount: 2 },
        ],
      },
    },
    include: { positionTemplate: true },
  });

  console.log('Seed: Liederdatenbank mit Arrangements…');
  // Fiktive Titel und CCLI-Nummern – reine Demo-Daten
  const SONGS: Array<
    [string, string | null, number | null, string | null, Array<[string, string]>]
  > = [
    ['Größer als alles', 'D', 72, '7061312', [['Akustik', 'C']]],
    ['Du bist treu', 'G', 68, '7024581', []],
    [
      'Licht dieser Stadt',
      'A',
      128,
      '7103205',
      [
        ['Band', 'A'],
        ['Unplugged', 'G'],
      ],
    ],
    ['Anker in der Zeit', 'E', 74, '7011429', []],
    ['Hier bin ich', 'C', 82, '7088846', [['Piano', 'B']]],
    ['Ewig dein', 'F', 76, '7129973', []],
  ];
  const songs = [];
  for (const [title, defaultKey, tempoBpm, ccliNumber, arrangements] of SONGS) {
    const song = await prisma.song.create({
      data: {
        title,
        defaultKey,
        tempoBpm,
        ccliNumber,
        arrangements: { create: arrangements.map(([name, key]) => ({ name, key })) },
      },
      include: { arrangements: true },
    });
    songs.push(song);
  }

  // Nächste 8 Sonntage 10:00 aus der RRULE materialisieren
  const rule = new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.SU],
    dtstart: new Date(),
    count: 8,
  });
  const sundays = rule.all();

  for (const [index, sunday] of sundays.entries()) {
    const startsAt = new Date(sunday);
    startsAt.setHours(10, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + serviceType.durationMinutes * 60_000);
    const event = await prisma.event.create({
      data: {
        serviceTypeId: serviceType.id,
        title: 'Gottesdienst',
        startsAt,
        endsAt,
        location: 'Hauptsaal',
        status: 'PUBLISHED',
        slots: {
          create: serviceType.positionTemplate.map((tp) => ({
            positionId: tp.positionId,
            requiredCount: tp.requiredCount,
          })),
        },
      },
      include: { slots: true },
    });

    // Die ersten zwei Termine teilweise besetzen, damit die Plan-Ansicht
    // direkt etwas zeigt (gemischte Status)
    if (index < 2) {
      for (const [slotIndex, slot] of event.slots.slice(0, 4).entries()) {
        const candidates = await prisma.positionSkill.findMany({
          where: { positionId: slot.positionId },
          take: 1,
          skip: index, // pro Termin andere Person
        });
        if (candidates.length === 0) continue;
        await prisma.assignment.create({
          data: {
            slotId: slot.id,
            personId: candidates[0].personId,
            status: slotIndex === 0 ? 'ACCEPTED' : slotIndex === 1 ? 'DECLINED' : 'REQUESTED',
            assignedById: people[1].id,
            respondedAt: slotIndex < 2 ? new Date() : null,
          },
        });
      }

      // Ablaufplan für die ersten zwei Termine – zeigt Programmpunkte,
      // Lieder (inkl. Arrangement/CCLI) und Verantwortliche
      const [song1, song2, song3, song4] = [
        songs[index],
        songs[index + 2],
        songs[index + 4],
        songs[(index + 1) % songs.length],
      ];
      const planItems = [
        { title: 'Begrüßung & Gebet', durationMinutes: 5, responsiblePersonId: people[1].id },
        {
          title: 'Worship-Block',
          durationMinutes: 6,
          songId: song1.id,
          arrangementId: song1.arrangements[0]?.id ?? null,
          responsiblePersonId: people[1].id,
        },
        { title: 'Worship-Block', durationMinutes: 5, songId: song2.id },
        { title: 'Abkündigungen', durationMinutes: 5, responsiblePersonId: people[0].id },
        {
          title: 'Predigt',
          durationMinutes: 35,
          notes: index === 0 ? 'Reihe Bergpredigt, Teil 3' : 'Gastprediger',
          responsiblePersonId: people[3].id,
        },
        {
          title: 'Response-Lied',
          durationMinutes: 5,
          songId: song3.id,
          arrangementId: song3.arrangements[0]?.id ?? null,
        },
        { title: 'Kollekte', durationMinutes: 4, songId: song4.id },
        { title: 'Segen', durationMinutes: 3, responsiblePersonId: people[3].id },
      ];
      await prisma.servicePlanItem.createMany({
        data: planItems.map((item, sortOrder) => ({ eventId: event.id, sortOrder, ...item })),
      });
    }
  }

  // Kaffee-Theke ist zur Selbst-Eintragung freigegeben – zeigt den
  // Signup-Bereich auf dem Dashboard direkt mit Inhalt
  await prisma.eventPositionSlot.updateMany({
    where: { positionId: teams.Kaffee.positionIds[0] },
    data: { openForSignup: true },
  });

  console.log('Seed: Abwesenheiten…');
  const in3weeks = new Date(Date.now() + 21 * 86_400_000);
  const in4weeks = new Date(Date.now() + 28 * 86_400_000);
  await prisma.absence.create({
    data: { personId: people[5].id, fromDate: in3weeks, toDate: in4weeks, reason: 'Ferien' },
  });
  await prisma.recurringUnavailability.create({
    data: {
      personId: people[7].id,
      rrule: 'FREQ=MONTHLY;BYDAY=1SU',
      note: 'Jeden 1. Sonntag im Monat nicht verfügbar',
    },
  });

  console.log('Seed fertig. Logins:');
  console.log('  admin@example.org    / admin1234!    (Admin)');
  console.log('  leiter@example.org   / leiter1234!   (Teamleiter Worship)');
  console.log('  mitglied@example.org / mitglied1234! (Mitglied)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
