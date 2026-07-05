import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../auth.types';
import { IS_PUBLIC } from '../decorators';
import { SessionService } from '../session.service';

export const SESSION_COOKIE = 'serveflow_session';

// Global registrierter Guard: JEDE Route erfordert eine gültige Session,
// außer sie ist explizit mit @Public() markiert. So kann eine vergessene
// Guard-Annotation nie zu einem offenen Endpoint führen.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE];

    // Session auch auf @Public()-Routen anhängen, wenn vorhanden –
    // z. B. zeigt die Respond-Seite eingeloggten Nutzern mehr Kontext
    if (token) {
      const session = await this.sessions.get(token);
      if (session) {
        request.user = {
          accountId: session.accountId,
          personId: session.personId,
          globalRole: session.globalRole,
        };
        request.sessionToken = token;
      }
    }

    if (isPublic) return true;
    if (!request.user) throw new UnauthorizedException();
    return true;
  }
}
