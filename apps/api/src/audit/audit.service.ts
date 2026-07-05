import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  // Nur Feldnamen protokollieren, niemals Werte – das Audit-Log darf
  // selbst kein Datenleck werden (siehe docs/security.md)
  changedFields?: string[];
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Bewusst fire-and-forget mit Fehler-Logging: Ein Audit-Schreibfehler
  // darf den fachlichen Request nicht abbrechen. Die Tabelle selbst ist
  // per DB-Trigger append-only (siehe Migration in Modul 3).
  log(entry: AuditEntry): void {
    void this.prisma.auditLog
      .create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          changedFields: entry.changedFields
            ? (entry.changedFields as Prisma.InputJsonValue)
            : undefined,
          ip: entry.ip ?? null,
        },
      })
      .catch((error: unknown) => {
        this.logger.error(`Audit-Log-Eintrag fehlgeschlagen: ${String(error)}`);
      });
  }
}
