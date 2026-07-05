import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedRequest, AuthUser } from './auth.types';

// Markiert Routen, die ohne Login erreichbar sind (Login selbst,
// Health, tokenbasierte Zusage/Absage, iCal). Alles andere ist per
// globalem Guard geschützt – "secure by default".
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

// Markiert Routen, die die globale Admin-Rolle erfordern.
export const REQUIRE_ADMIN = 'requireAdmin';
export const RequireAdmin = () => SetMetadata(REQUIRE_ADMIN, true);

// Liefert den eingeloggten Nutzer im Controller:  @CurrentUser() user: AuthUser
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      // Darf nie passieren, wenn der Guard korrekt registriert ist –
      // lieber laut scheitern als undefined weiterreichen
      throw new Error('CurrentUser ohne SessionAuthGuard verwendet');
    }
    return request.user;
  },
);
