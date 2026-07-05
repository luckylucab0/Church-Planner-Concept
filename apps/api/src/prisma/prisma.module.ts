import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: PrismaService wird von praktisch jedem Feature-Modul gebraucht –
// ein globales Modul erspart identische imports-Zeilen in jedem Modul.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
