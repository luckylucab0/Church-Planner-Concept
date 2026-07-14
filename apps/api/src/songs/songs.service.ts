import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateArrangementDto,
  CreateSongDto,
  ImportSongDto,
  UpdateArrangementDto,
  UpdateSongDto,
} from './dto/songs.dto';
import { parseSongFile, SongFileParseError } from './song-file-parser';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

const CCLI_LICENSE_KEY = 'ccliLicenseNumber';

@Injectable()
export class SongsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // Lieder pflegen darf, wer in irgendeinem Team die Capability
  // MANAGE_SONGS hat: die Liederdatenbank ist eine gemeinsame
  // Ressource, kein Team-Besitz.
  private async ensureCanManage(user: AuthUser): Promise<void> {
    if (await this.permissions.hasCapabilityInAnyTeam(user, 'MANAGE_SONGS')) return;
    throw new ForbiddenException('Dir fehlt das Recht, die Liederdatenbank zu pflegen');
  }

  async list(user: AuthUser, query?: string) {
    const songs = await this.prisma.song.findMany({
      where: query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { ccliNumber: { contains: query } },
            ],
          }
        : undefined,
      include: { arrangements: { orderBy: { name: 'asc' } } },
      orderBy: { title: 'asc' },
    });
    const canManage = await this.permissions.hasCapabilityInAnyTeam(user, 'MANAGE_SONGS');
    return { canManage, songs };
  }

  async create(user: AuthUser, dto: CreateSongDto) {
    await this.ensureCanManage(user);
    const song = await this.prisma.song.create({
      data: dto,
      include: { arrangements: true },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'CREATE',
      entityType: 'Song',
      entityId: song.id,
    });
    return song;
  }

  async update(user: AuthUser, songId: string, dto: UpdateSongDto) {
    await this.ensureCanManage(user);
    await this.ensureSongExists(songId);
    const song = await this.prisma.song.update({
      where: { id: songId },
      data: dto,
      include: { arrangements: { orderBy: { name: 'asc' } } },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Song',
      entityId: songId,
      changedFields: Object.keys(dto),
    });
    return song;
  }

  async delete(user: AuthUser, songId: string): Promise<void> {
    await this.ensureCanManage(user);
    await this.ensureSongExists(songId);
    // Ablaufpunkte behalten Titel als Text – die Lied-Referenz wird per
    // ON DELETE SET NULL gelöst, Pläne bleiben lesbar
    await this.prisma.song.delete({ where: { id: songId } });
    this.audit.log({
      actorId: user.personId,
      action: 'DELETE',
      entityType: 'Song',
      entityId: songId,
    });
  }

  // --- Datei-Import (ChordPro / SongSelect-Text) ---------------

  async importFile(user: AuthUser, dto: ImportSongDto) {
    await this.ensureCanManage(user);
    let parsed;
    try {
      parsed = parseSongFile(dto.content, dto.filename);
    } catch (error) {
      if (error instanceof SongFileParseError) {
        throw new BadRequestException({ message: 'songs.importParseError' });
      }
      throw error;
    }

    const data = {
      title: parsed.title,
      defaultKey: parsed.key,
      tempoBpm: parsed.tempoBpm,
      ccliNumber: parsed.ccliNumber,
      author: parsed.author,
      copyright: parsed.copyright,
      lyrics: parsed.lyrics,
    };

    // Dedupe über die CCLI-Nummer: dieselbe Datei zweimal importieren
    // soll kein Duplikat erzeugen, sondern (nur auf Wunsch) aktualisieren
    if (parsed.ccliNumber) {
      const existing = await this.prisma.song.findFirst({
        where: { ccliNumber: parsed.ccliNumber },
        select: { id: true },
      });
      if (existing && !dto.overwrite) {
        throw new ConflictException({
          message: 'songs.duplicateCcli',
          code: 'DUPLICATE_CCLI',
          songId: existing.id,
        });
      }
      if (existing) {
        const song = await this.prisma.song.update({
          where: { id: existing.id },
          data,
          include: { arrangements: { orderBy: { name: 'asc' } } },
        });
        this.audit.log({
          actorId: user.personId,
          action: 'IMPORT',
          entityType: 'Song',
          entityId: song.id,
          changedFields: Object.keys(data),
        });
        return { created: false, song };
      }
    }

    const song = await this.prisma.song.create({
      data,
      include: { arrangements: true },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'IMPORT',
      entityType: 'Song',
      entityId: song.id,
    });
    return { created: true, song };
  }

  // --- CCLI-Nutzungsbericht ------------------------------------

  // Zählt pro Lied, in wie vielen (nicht abgesagten) Terminen des
  // Zeitraums es im Ablaufplan vorkam – dasselbe Lied zweimal im selben
  // Gottesdienst zählt einmal (CCLI-Zählweise: pro Verwendungstag).
  async ccliReport(user: AuthUser, from: string, to: string) {
    await this.ensureCanManage(user);
    const fromDate = new Date(from);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (fromDate > toDate) {
      throw new BadRequestException('from muss vor to liegen');
    }
    const items = await this.prisma.servicePlanItem.findMany({
      where: {
        songId: { not: null },
        event: { startsAt: { gte: fromDate, lte: toDate }, status: { not: 'CANCELLED' } },
      },
      select: {
        songId: true,
        eventId: true,
        song: { select: { title: true, ccliNumber: true, author: true } },
      },
    });

    const perSong = new Map<
      string,
      { title: string; ccliNumber: string | null; author: string | null; events: Set<string> }
    >();
    for (const item of items) {
      if (!item.songId || !item.song) continue;
      const entry = perSong.get(item.songId) ?? { ...item.song, events: new Set<string>() };
      entry.events.add(item.eventId);
      perSong.set(item.songId, entry);
    }

    const license = await this.prisma.setting.findUnique({ where: { key: CCLI_LICENSE_KEY } });
    return {
      licenseNumber: (license?.value as string | null) ?? null,
      from,
      to,
      rows: [...perSong.values()]
        .map(({ events, ...song }) => ({ ...song, count: events.size }))
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
    };
  }

  async setCcliLicense(user: AuthUser, licenseNumber: string) {
    const value = licenseNumber.trim();
    await this.prisma.setting.upsert({
      where: { key: CCLI_LICENSE_KEY },
      create: { key: CCLI_LICENSE_KEY, value },
      update: { value },
    });
    this.audit.log({
      actorId: user.personId,
      action: 'UPDATE',
      entityType: 'Setting',
      entityId: CCLI_LICENSE_KEY,
    });
    return { licenseNumber: value };
  }

  // --- Arrangements -------------------------------------------

  async createArrangement(user: AuthUser, songId: string, dto: CreateArrangementDto) {
    await this.ensureCanManage(user);
    await this.ensureSongExists(songId);
    return this.prisma.songArrangement.create({ data: { songId, ...dto } });
  }

  async updateArrangement(
    user: AuthUser,
    songId: string,
    arrangementId: string,
    dto: UpdateArrangementDto,
  ) {
    await this.ensureCanManage(user);
    await this.findArrangement(songId, arrangementId);
    return this.prisma.songArrangement.update({ where: { id: arrangementId }, data: dto });
  }

  async deleteArrangement(user: AuthUser, songId: string, arrangementId: string): Promise<void> {
    await this.ensureCanManage(user);
    await this.findArrangement(songId, arrangementId);
    await this.prisma.songArrangement.delete({ where: { id: arrangementId } });
  }

  private async ensureSongExists(songId: string): Promise<void> {
    const song = await this.prisma.song.findUnique({ where: { id: songId }, select: { id: true } });
    if (!song) throw new NotFoundException();
  }

  // Arrangement immer über die Song-ID mit adressieren – verhindert,
  // dass ein Arrangement eines anderen Lieds "durchgeschoben" wird
  private async findArrangement(songId: string, arrangementId: string) {
    const arrangement = await this.prisma.songArrangement.findFirst({
      where: { id: arrangementId, songId },
    });
    if (!arrangement) throw new NotFoundException();
    return arrangement;
  }
}
