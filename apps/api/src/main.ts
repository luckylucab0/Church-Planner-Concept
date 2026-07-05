import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { env } from './common/config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // trustProxy: die API läuft immer hinter Caddy – nur so stimmen
    // Client-IPs im Audit-Log und Rate Limiting
    new FastifyAdapter({ trustProxy: true }),
  );

  app.setGlobalPrefix('api');
  // URI-Versionierung (/api/v1/...): Mobile-Apps können später gegen v1
  // weiterlaufen, während das Web-Frontend v2 nutzt
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // CSP kommt zentral vom Caddy-Proxy; die API liefert nur JSON.
  // Die übrigen Helmet-Header schaden auch hinter dem Proxy nicht.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie, { secret: env.COOKIE_SECRET });

  // Nur in dev nötig (Web auf :5173, API auf :3000). In Produktion sind
  // beide same-origin hinter Caddy, credentials-CORS bleibt eng gefasst.
  app.enableCors({ origin: env.APP_URL, credentials: true });

  // whitelist + forbidNonWhitelisted: unbekannte Felder werden abgelehnt
  // statt still ignoriert (Schutz vor Mass Assignment)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('ServeFlow API')
    .setDescription(
      'REST-API für Diensteinteilung und Gottesdienstplanung. ' +
        'Das Web-Frontend konsumiert ausschließlich diese API.',
    )
    .setVersion('1')
    .addCookieAuth('serveflow_session')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

void bootstrap();
