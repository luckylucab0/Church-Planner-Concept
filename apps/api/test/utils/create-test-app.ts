// Baut die App für Integrationstests exakt so wie main.ts (Guards,
// Pipes, Cookies, Prefix) – Abweichungen zwischen Test- und
// Produktions-Bootstrap würden sonst genau die Security-Schichten
// untesten lassen, um die es geht.
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookie from '@fastify/cookie';
import { AppModule } from '../../src/app.module';
import { env } from '../../src/common/config/env';

// Prisma-Client für Test-Fixtures: nutzt dieselbe (Test-)DB-URL wie die
// App selbst, inkl. des Test-Defaults aus der zentralen Config.
export const testPrisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.register(cookie);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

// Session-Cookie aus einer Login-Response extrahieren
export function sessionCookieFrom(setCookieHeader: string | string[] | undefined): string {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
  const sessionHeader = headers.find((h) => h.startsWith('serveflow_session='));
  if (!sessionHeader) throw new Error('Kein Session-Cookie in der Response');
  return sessionHeader.split(';')[0];
}
