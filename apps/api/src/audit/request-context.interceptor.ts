import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithRequestContext } from './request-context';

// Füllt den Request-Kontext (siehe request-context.ts), damit der
// AuditService die Client-IP kennt, ohne dass sie durch jede
// Service-Signatur gereicht werden muss.
//
// Warum ein Interceptor und kein Fastify-Hook in main.ts: Als
// APP_INTERCEPTOR hängt er am AppModule und gilt damit automatisch auch für
// die Test-App (test/utils/create-test-app.ts baut dasselbe Modul). Ein Hook
// in main.ts müsste dort doppelt gepflegt werden – und genau solche
// Abweichungen lassen die Security-Schichten im Test ungeprüft.
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();

    // Wichtig: next.handle() liefert ein KALTES Observable – der Route-Handler
    // läuft erst beim Abonnieren, und das passiert erst, nachdem dieser
    // Interceptor zurückgekehrt ist. Ein simples
    // runWithRequestContext(ctx, () => next.handle()) würde den Kontext
    // deshalb wieder verlassen, bevor der Handler überhaupt startet. Der
    // Kontext muss das ABONNEMENT umschließen, nicht den Aufruf.
    return new Observable((subscriber) =>
      runWithRequestContext({ ip: request.ip }, () => next.handle().subscribe(subscriber)),
    );
  }
}
