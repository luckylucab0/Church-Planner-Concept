import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as argon2 from 'argon2';
import { env } from './config/env';
import { PrismaService } from '../prisma/prisma.service';

// Erst-Einrichtung ohne DB-Gefummel: Wenn noch KEIN Login-Konto
// existiert und SEED_ADMIN_EMAIL/-PASSWORD gesetzt sind, wird beim
// Start ein Admin-Konto angelegt. Sobald irgendein Konto existiert,
// passiert hier nie wieder etwas – die Variablen können (und sollten)
// nach dem ersten Login entfernt werden.
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) return;
    const accounts = await this.prisma.userAccount.count();
    if (accounts > 0) return;

    await this.prisma.person.create({
      data: {
        firstName: 'Admin',
        lastName: 'ServeFlow',
        email: env.SEED_ADMIN_EMAIL,
        account: {
          create: {
            passwordHash: await argon2.hash(env.SEED_ADMIN_PASSWORD, { type: argon2.argon2id }),
            globalRole: 'ADMIN',
          },
        },
        privacySettings: { create: {} },
      },
    });
    this.logger.warn(
      `Erst-Admin ${env.SEED_ADMIN_EMAIL} angelegt – SEED_ADMIN_* nach dem ersten Login aus der .env entfernen`,
    );
  }
}
