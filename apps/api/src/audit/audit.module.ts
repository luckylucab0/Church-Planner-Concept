import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global, weil praktisch jedes Feature-Modul Personendaten-Zugriffe
// protokollieren muss.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
