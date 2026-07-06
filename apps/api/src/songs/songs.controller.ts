import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateArrangementDto,
  CreateSongDto,
  UpdateArrangementDto,
  UpdateSongDto,
} from './dto/songs.dto';
import { SongsService } from './songs.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';

@ApiTags('songs')
@Controller('songs')
export class SongsController {
  constructor(private readonly songs: SongsService) {}

  @Get()
  @ApiOperation({ summary: 'Liederdatenbank durchsuchen (alle Eingeloggten)' })
  list(@CurrentUser() user: AuthUser, @Query('query') query?: string) {
    return this.songs.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'Lied anlegen (Admin oder Teamleiter)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSongDto) {
    return this.songs.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Lied ändern (Admin oder Teamleiter)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSongDto,
  ) {
    return this.songs.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Lied löschen (Admin oder Teamleiter)' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.songs.delete(user, id);
  }

  // --- Arrangements -------------------------------------------

  @Post(':id/arrangements')
  @ApiOperation({ summary: 'Arrangement anlegen (Admin oder Teamleiter)' })
  createArrangement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateArrangementDto,
  ) {
    return this.songs.createArrangement(user, id, dto);
  }

  @Patch(':id/arrangements/:arrangementId')
  @ApiOperation({ summary: 'Arrangement ändern (Admin oder Teamleiter)' })
  updateArrangement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('arrangementId', ParseUUIDPipe) arrangementId: string,
    @Body() dto: UpdateArrangementDto,
  ) {
    return this.songs.updateArrangement(user, id, arrangementId, dto);
  }

  @Delete(':id/arrangements/:arrangementId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Arrangement löschen (Admin oder Teamleiter)' })
  async deleteArrangement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('arrangementId', ParseUUIDPipe) arrangementId: string,
  ): Promise<void> {
    await this.songs.deleteArrangement(user, id, arrangementId);
  }
}
