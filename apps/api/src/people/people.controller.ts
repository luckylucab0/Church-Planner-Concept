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
import { CreateNoteDto, CreatePersonDto, UpdatePersonDto } from './dto/people.dto';
import { NotesService } from './notes.service';
import { PeopleService } from './people.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequireAdmin } from '../auth/decorators';

@ApiTags('people')
@Controller('people')
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly notes: NotesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Personenliste (Felder je nach Rolle gefiltert)' })
  list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.people.list(user, search);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Personendetail (Felder je nach Rolle gefiltert)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.people.get(user, id);
  }

  @Post()
  @RequireAdmin()
  @ApiOperation({ summary: 'Person anlegen (nur Admin)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePersonDto) {
    return this.people.create(user, dto);
  }

  @Patch(':id')
  @RequireAdmin()
  @ApiOperation({ summary: 'Person ändern (nur Admin)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.people.update(user, id, dto);
  }

  @Delete(':id')
  @RequireAdmin()
  @HttpCode(204)
  @ApiOperation({ summary: 'Person vollständig löschen (Recht auf Vergessen)' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.people.delete(user, id);
  }

  @Post(':id/anonymize')
  @RequireAdmin()
  @HttpCode(204)
  @ApiOperation({ summary: 'Person anonymisieren (Planhistorie bleibt erhalten)' })
  async anonymize(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.people.anonymize(user, id);
  }

  @Get(':id/export')
  @RequireAdmin()
  @ApiOperation({ summary: 'Datenexport einer Person (DSGVO Art. 15/20)' })
  export(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.people.exportData(user, id);
  }

  // --- Notizen (eigene Berechtigungsstufe) ------------------

  @Get(':id/notes')
  @ApiOperation({ summary: 'Notizen zu einer Person (GENERAL: Leiter+Admin, PASTORAL: Admin)' })
  listNotes(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.listFor(user, id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Notiz anlegen (verschlüsselt gespeichert)' })
  createNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.notes.create(user, id, dto.kind, dto.content);
  }

  @Delete('notes/:noteId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Notiz löschen' })
  async deleteNote(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    await this.notes.delete(user, noteId);
  }
}
