import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsString, MaxLength } from 'class-validator';
import { ImportService } from './import.service';
import { PcoApiClient } from './pco-api.client';
import { ColumnMapping } from './types';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequireAdmin } from '../auth/decorators';

export class CreateImportDto {
  @ApiProperty({ enum: ['ELVANTO_CSV', 'PCO_CSV'] })
  @IsIn(['ELVANTO_CSV', 'PCO_CSV'])
  source: 'ELVANTO_CSV' | 'PCO_CSV';

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName: string;

  // CSV als Text im JSON-Body (die UI liest die Datei clientseitig):
  // hält das Backend frei von Multipart-Sonderfällen
  @ApiProperty({ description: 'CSV-Inhalt als Text (max. ~5 MB)' })
  @IsString()
  @MaxLength(5_000_000)
  content: string;
}

export class SetMappingDto {
  @ApiProperty({ description: 'Quellspalte → Zielfeld' })
  @IsObject()
  mapping: ColumnMapping;
}

export class PcoApiImportDto {
  @ApiProperty({ description: 'Planning Center App-ID (Personal Access Token)' })
  @IsString()
  @MaxLength(200)
  appId: string;

  @ApiProperty({ description: 'Planning Center Secret' })
  @IsString()
  @MaxLength(200)
  secret: string;
}

// Import-Assistent, komplett Admin-only. Ablauf siehe import.service.ts.
@ApiTags('import')
@RequireAdmin()
@Controller('admin/import')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly pcoClient: PcoApiClient,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Letzte Import-Vorgänge' })
  list() {
    return this.importService.listJobs();
  }

  @Post()
  @ApiOperation({ summary: 'CSV hochladen → automatische Spaltenerkennung' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateImportDto) {
    return this.importService.createJob(user, dto.source, dto.fileName, dto.content);
  }

  @Put(':id/mapping')
  @ApiOperation({ summary: 'Spalten-Mapping bestätigen/anpassen' })
  setMapping(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetMappingDto) {
    return this.importService.setMapping(id, dto.mapping);
  }

  @Post(':id/dry-run')
  @ApiOperation({ summary: 'Vorschau: was würde angelegt/aktualisiert/übersprungen' })
  dryRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.importService.dryRun(id);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Import ausführen (fehlerhafte Zeilen brechen nicht ab)' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.importService.confirm(user, id);
  }

  @Get(':id/errors.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="import-fehler.csv"')
  @ApiOperation({ summary: 'Fehlerreport als CSV herunterladen' })
  errors(@Param('id', ParseUUIDPipe) id: string) {
    return this.importService.errorReportCsv(id);
  }

  // PCO-API-Import: lädt Personen über die REST-API und erzeugt daraus
  // einen normalen Import-Job (kanonische Spalten, Mapping vorbelegt) –
  // Dry-Run und Confirm laufen identisch zum CSV-Weg
  @Post('pco-api')
  @ApiOperation({ summary: 'Personen direkt aus der Planning-Center-API laden' })
  async pcoApi(@CurrentUser() user: AuthUser, @Body() dto: PcoApiImportDto) {
    const rows = await this.pcoClient.fetchPeople(dto.appId, dto.secret);
    const csv = toCsv(rows);
    return this.importService.createJob(user, 'PCO_API', 'planning-center-api', csv);
  }
}

// Mini-CSV-Serialisierung für den API→Pipeline-Übergang
function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return 'First Name,Last Name\n';
  const headers = Object.keys(rows[0]);
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header] ?? '')).join(',')),
  ].join('\n');
}
