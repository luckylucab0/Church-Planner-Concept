import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth.types';
import { env } from '../../common/config/env';

// CSRF-Schutz für die Cookie-basierte Auth: Browser senden bei
// Cross-Site-Requests immer einen Origin-Header. Zustandsändernde
// Requests mit fremdem Origin werden abgelehnt. Requests OHNE
// Origin-Header (curl, Tests, native Apps) sind erlaubt – sie tragen
// keine Ambient Authority eines fremden Browser-Kontexts.
// Ergänzt SameSite=Lax als zweite Verteidigungslinie.
@Injectable()
export class OriginCheckGuard implements CanActivate {
  private readonly allowedOrigin = new URL(env.APP_URL).origin;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;

    const origin = request.headers['origin'];
    if (typeof origin !== 'string' || origin === '') return true;
    if (origin !== this.allowedOrigin) {
      throw new ForbiddenException('Origin nicht erlaubt (CSRF-Schutz)');
    }
    return true;
  }
}
