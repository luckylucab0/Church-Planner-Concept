import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../auth.types';
import { REQUIRE_ADMIN } from '../decorators';

// Prüft @RequireAdmin(). Feinere Berechtigungen (Teamleiter, Field-Level)
// entscheiden die Policies in src/authz – dieser Guard deckt nur die
// harte globale Admin-Grenze ab.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireAdmin = this.reflector.getAllAndOverride<boolean>(REQUIRE_ADMIN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requireAdmin) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.globalRole !== 'ADMIN') {
      throw new ForbiddenException('Nur für Administratoren');
    }
    return true;
  }
}
