import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateArrangementDto,
  CreateSongDto,
  UpdateArrangementDto,
  UpdateSongDto,
} from './dto/songs.dto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../authz/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SongsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // Lieder pflegen dürfen Admins und Teamleiter (egal welchen Teams):
  // die Liederdatenbank ist eine gemeinsame Ressource, kein Team-Besitz.
  private async ensureCanManage(user: AuthUser): Promise<void> {
    if (this.permissions.isAdmin(user)) return;
    if (await this.permissions.isAnyTeamLeader(user.personId)) return;
    throw new ForbiddenException('Nur Admins oder Teamleiter');
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
    const canManage =
      this.permissions.isAdmin(user) || (await this.permissions.isAnyTeamLeader(user.personId));
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
