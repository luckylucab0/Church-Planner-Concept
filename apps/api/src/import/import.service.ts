import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ImportSource, Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { parseBirthday, suggestMapping } from './mapping';
import { ColumnMapping, ImportPersonRecord, RowPlan, TARGET_FIELDS } from './types';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 10_000;

// Import-Pipeline (quellenunabhängig, siehe types.ts):
//   Upload → automatisches Mapping → Admin bestätigt Mapping →
//   Dry-Run (Vorschau: was würde passieren) → Confirm (Ausführung).
// Fehlerhafte Zeilen brechen den Import NIE ab – sie landen im
// herunterladbaren Fehlerreport.
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Schritt 1: Upload + Spaltenerkennung ------------------

  async createJob(user: AuthUser, source: ImportSource, fileName: string, csvContent: string) {
    let rows: Record<string, string>[];
    try {
      rows = parse(csvContent, {
        columns: true, // erste Zeile = Header
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true, // krumme Zeilen tolerieren → Fehlerreport
      }) as Record<string, string>[];
    } catch (error) {
      throw new BadRequestException(`CSV konnte nicht gelesen werden: ${String(error)}`);
    }
    if (rows.length === 0) throw new BadRequestException('Die Datei enthält keine Datenzeilen');
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`Maximal ${MAX_ROWS} Zeilen pro Import`);
    }

    const headers = Object.keys(rows[0]);
    const suggested = suggestMapping(headers, source);

    const job = await this.prisma.importJob.create({
      data: {
        source,
        fileName,
        status: 'MAPPING',
        columnMapping: suggested,
        startedById: user.personId,
        rows: {
          create: rows.map((raw, index) => ({
            rowNumber: index + 2, // +2: 1-basiert plus Headerzeile
            outcome: 'SKIPPED', // Platzhalter bis zum Dry-Run
            rawData: raw as Prisma.InputJsonObject,
          })),
        },
      },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'IMPORT',
      entityType: 'ImportJob',
      entityId: job.id,
    });

    return {
      id: job.id,
      headers,
      suggestedMapping: suggested,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5),
    };
  }

  async setMapping(jobId: string, mapping: ColumnMapping) {
    const job = await this.loadJob(jobId);
    for (const target of Object.values(mapping)) {
      if (!TARGET_FIELDS.includes(target)) {
        throw new BadRequestException(`Unbekanntes Zielfeld: ${target}`);
      }
    }
    // Ohne Namen ist keine Person anlegbar
    const targets = Object.values(mapping);
    if (!targets.includes('firstName') || !targets.includes('lastName')) {
      throw new BadRequestException('Mapping braucht mindestens Vorname und Nachname');
    }
    await this.prisma.importJob.update({
      where: { id: job.id },
      data: { columnMapping: mapping, status: 'MAPPING' },
    });
    return { ok: true };
  }

  // --- Schritt 2: Dry-Run ------------------------------------

  async dryRun(jobId: string) {
    const job = await this.loadJob(jobId, true);
    const plans = await this.planRows(
      job.rows.map((r) => ({
        rowNumber: r.rowNumber,
        raw: r.rawData as Record<string, string>,
      })),
      job.columnMapping as ColumnMapping,
    );

    // Vorschau-Ergebnis pro Zeile persistieren + Zusammenfassung
    const summary = { CREATED: 0, UPDATED: 0, MERGED: 0, SKIPPED: 0, ERROR: 0 };
    for (const plan of plans) summary[plan.outcome]++;

    await this.prisma.$transaction([
      ...plans.map((plan) =>
        this.prisma.importRow.updateMany({
          where: { jobId, rowNumber: plan.rowNumber },
          data: { outcome: plan.outcome, errorMessage: plan.error ?? null },
        }),
      ),
      this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'DRY_RUN', dryRunSummary: summary },
      }),
    ]);

    return {
      summary,
      rows: plans.slice(0, 50).map((plan) => ({
        rowNumber: plan.rowNumber,
        outcome: plan.outcome,
        error: plan.error,
        name: plan.record ? `${plan.record.firstName} ${plan.record.lastName}` : null,
      })),
    };
  }

  // --- Schritt 3: Ausführung ---------------------------------

  async confirm(user: AuthUser, jobId: string) {
    const job = await this.loadJob(jobId, true);
    if (job.status !== 'DRY_RUN') {
      throw new BadRequestException('Erst den Dry-Run ausführen und prüfen');
    }
    const mapping = job.columnMapping as ColumnMapping;
    const plans = await this.planRows(
      job.rows.map((r) => ({ rowNumber: r.rowNumber, raw: r.rawData as Record<string, string> })),
      mapping,
    );

    const summary = { CREATED: 0, UPDATED: 0, MERGED: 0, SKIPPED: 0, ERROR: 0 };
    for (const plan of plans) {
      // Zeilenweise ausführen: ein Fehler betrifft nur diese Zeile
      try {
        await this.executePlan(plan);
      } catch (error) {
        plan.outcome = 'ERROR';
        plan.error = String(error instanceof Error ? error.message : error);
      }
      summary[plan.outcome]++;
      await this.prisma.importRow.updateMany({
        where: { jobId, rowNumber: plan.rowNumber },
        data: {
          outcome: plan.outcome,
          errorMessage: plan.error ?? null,
          personId: plan.personId ?? null,
        },
      });
    }

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'DONE', dryRunSummary: summary },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'IMPORT',
      entityType: 'ImportJob',
      entityId: jobId,
      changedFields: Object.entries(summary).map(([key, value]) => `${key}:${value}`),
    });
    return { summary };
  }

  // --- Fehlerreport ------------------------------------------

  async errorReportCsv(jobId: string): Promise<string> {
    await this.loadJob(jobId);
    const rows = await this.prisma.importRow.findMany({
      where: { jobId, outcome: { in: ['ERROR', 'SKIPPED'] } },
      orderBy: { rowNumber: 'asc' },
    });
    return stringify(
      rows.map((row) => ({
        rowNumber: row.rowNumber,
        outcome: row.outcome,
        error: row.errorMessage ?? '',
        ...(row.rawData as Record<string, string>),
      })),
      { header: true },
    );
  }

  async listJobs() {
    return this.prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        source: true,
        status: true,
        fileName: true,
        createdAt: true,
        dryRunSummary: true,
      },
    });
  }

  // --- Kern: Zeilen normalisieren + Duplikate erkennen --------

  private buildRecord(raw: Record<string, string>, mapping: ColumnMapping): ImportPersonRecord {
    const record: ImportPersonRecord = { firstName: '', lastName: '', teams: [], extraNotes: [] };
    for (const [column, target] of Object.entries(mapping)) {
      const value = (raw[column] ?? '').trim();
      if (!value || target === 'ignore') continue;
      switch (target) {
        case 'firstName':
          record.firstName = value;
          break;
        case 'lastName':
          record.lastName = value;
          break;
        case 'email':
          record.email = value.toLowerCase();
          break;
        case 'phone':
          record.phone = value;
          break;
        case 'birthday':
          record.birthday = parseBirthday(value);
          break;
        case 'address':
          record.address = value;
          break;
        case 'teams':
          record.teams.push(
            ...value
              .split(/[,;]/)
              .map((team) => team.trim())
              .filter(Boolean),
          );
          break;
        case 'notes':
          record.extraNotes.push(`${column}: ${value}`);
          break;
      }
    }
    return record;
  }

  private async planRows(
    rows: { rowNumber: number; raw: Record<string, string> }[],
    mapping: ColumnMapping,
  ): Promise<RowPlan[]> {
    const records = rows.map((row) => ({
      ...row,
      record: this.buildRecord(row.raw, mapping),
    }));

    // Bestehende Personen für die Duplikat-Erkennung in zwei
    // Batch-Queries laden: E-Mail (primär), Name+Geburtstag (Fallback)
    const emails = records.map((r) => r.record.email).filter((e): e is string => !!e);
    const byEmail = new Map(
      (
        await this.prisma.person.findMany({
          where: { email: { in: emails, mode: 'insensitive' } },
          select: { id: true, email: true },
        })
      ).map((person) => [person.email!.toLowerCase(), person.id]),
    );
    const namePairs = records
      .filter((r) => r.record.birthday && r.record.firstName && r.record.lastName)
      .map((r) => r.record);
    const byNameBirthday = new Map<string, string>();
    if (namePairs.length > 0) {
      const candidates = await this.prisma.person.findMany({
        where: {
          birthday: { not: null },
          OR: namePairs.map((record) => ({
            firstName: { equals: record.firstName, mode: 'insensitive' as const },
            lastName: { equals: record.lastName, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, firstName: true, lastName: true, birthday: true },
      });
      for (const person of candidates) {
        const key = `${person.firstName.toLowerCase()}|${person.lastName.toLowerCase()}|${person.birthday!.toISOString().slice(0, 10)}`;
        byNameBirthday.set(key, person.id);
      }
    }

    return records.map(({ rowNumber, raw, record }): RowPlan => {
      if (!record.firstName || !record.lastName) {
        return { rowNumber, raw, outcome: 'SKIPPED', error: 'Vor- oder Nachname fehlt' };
      }
      if (record.email && !EMAIL_REGEX.test(record.email)) {
        return {
          rowNumber,
          raw,
          record,
          outcome: 'ERROR',
          error: `Ungültige E-Mail: ${record.email}`,
        };
      }
      if (record.email && byEmail.has(record.email)) {
        return { rowNumber, raw, record, outcome: 'UPDATED', personId: byEmail.get(record.email) };
      }
      if (record.birthday) {
        const key = `${record.firstName.toLowerCase()}|${record.lastName.toLowerCase()}|${record.birthday.toISOString().slice(0, 10)}`;
        if (byNameBirthday.has(key)) {
          return { rowNumber, raw, record, outcome: 'MERGED', personId: byNameBirthday.get(key) };
        }
      }
      return { rowNumber, raw, record, outcome: 'CREATED' };
    });
  }

  // Führt einen Zeilen-Plan aus. Merge-Strategie: vorhandene Werte der
  // bestehenden Person gewinnen, nur leere Felder werden aufgefüllt –
  // ein Import überschreibt nie gepflegte Daten.
  private async executePlan(plan: RowPlan): Promise<void> {
    if (plan.outcome === 'SKIPPED' || plan.outcome === 'ERROR' || !plan.record) return;
    const record = plan.record;
    const importNotes = record.extraNotes.length > 0 ? record.extraNotes.join('\n') : undefined;

    if (plan.outcome === 'CREATED') {
      const person = await this.prisma.person.create({
        data: {
          firstName: record.firstName,
          lastName: record.lastName,
          email: record.email,
          phone: record.phone,
          birthday: record.birthday,
          address: record.address,
          importNotes,
          privacySettings: { create: {} },
        },
      });
      plan.personId = person.id;
    } else {
      // UPDATED (E-Mail-Match) oder MERGED (Name+Geburtstag-Match)
      const existing = await this.prisma.person.findUniqueOrThrow({
        where: { id: plan.personId! },
      });
      await this.prisma.person.update({
        where: { id: existing.id },
        data: {
          email: existing.email ?? record.email,
          phone: existing.phone ?? record.phone,
          birthday: existing.birthday ?? record.birthday,
          address: existing.address ?? record.address,
          importNotes: [existing.importNotes, importNotes].filter(Boolean).join('\n') || null,
        },
      });
    }

    // Teams: per Name finden oder anlegen, Mitgliedschaft idempotent
    for (const teamName of record.teams) {
      const team = await this.prisma.team.upsert({
        where: { name: teamName },
        create: { name: teamName },
        update: {},
      });
      await this.prisma.teamMembership.upsert({
        where: { teamId_personId: { teamId: team.id, personId: plan.personId! } },
        create: { teamId: team.id, personId: plan.personId! },
        update: {},
      });
    }
  }

  private async loadJob(jobId: string, withRows = false) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      include: withRows ? { rows: { orderBy: { rowNumber: 'asc' } } } : undefined,
    });
    if (!job) throw new NotFoundException();
    return job as typeof job & { rows: { rowNumber: number; rawData: unknown }[] };
  }
}
