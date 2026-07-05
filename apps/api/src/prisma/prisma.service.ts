import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../common/config/env';

// Dünner Wrapper um den PrismaClient, der den Lebenszyklus an Nest koppelt
// (Verbindung bei App-Start aufbauen, bei Shutdown sauber schließen).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Die URL kommt aus der zentralen, validierten Config statt direkt aus
    // process.env – so gelten die Test-Defaults auch für Prisma
    super({ datasourceUrl: env.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
