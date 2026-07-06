import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { CalendarModule } from './calendar/calendar.module';
import { BootstrapAdminService } from './common/bootstrap-admin.service';
import { AdminGuard } from './auth/guards/admin.guard';
import { OriginCheckGuard } from './auth/guards/origin-check.guard';
import { SessionAuthGuard } from './auth/guards/session-auth.guard';
import { AuthzModule } from './authz/authz.module';
import { env } from './common/config/env';
import { HealthModule } from './health/health.module';
import { ImportModule } from './import/import.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PeopleModule } from './people/people.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { SongsModule } from './songs/songs.module';
import { TeamsModule } from './teams/teams.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthzModule,
    NotificationsModule,
    AuthModule,
    PeopleModule,
    TeamsModule,
    SchedulingModule,
    SongsModule,
    AvailabilityModule,
    AssignmentsModule,
    CalendarModule,
    ImportModule,
    HealthModule,
    // Basis-Rate-Limit für alle Endpoints; Auth-Routen setzen per
    // @Throttle deutlich engere Limits. In Tests deaktiviert – die
    // Integrationstests feuern viele Logins hintereinander ab.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      skipIf: () => env.NODE_ENV === 'test',
    }),
  ],
  providers: [
    // Reihenfolge = Ausführungsreihenfolge:
    // 1. Rate Limiting (billig, schützt alles danach)
    // 2. CSRF-Origin-Check für zustandsändernde Requests
    // 3. Session-Auth (secure by default, @Public() als Ausnahme)
    // 4. Admin-Check für @RequireAdmin()-Routen
    BootstrapAdminService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginCheckGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
})
export class AppModule {}
