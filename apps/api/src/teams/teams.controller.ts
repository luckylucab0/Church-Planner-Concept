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
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AddMemberDto,
  CreatePositionDto,
  CreateTeamDto,
  SetPermissionsDto,
  SetSkillDto,
  UpdateMemberRoleDto,
  UpdateTeamDto,
} from './dto/teams.dto';
import { TeamsService } from './teams.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequireAdmin } from '../auth/decorators';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'Alle Teams mit Positionen (für alle Mitglieder sichtbar)' })
  list(@CurrentUser() user: AuthUser) {
    return this.teams.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Team-Detail (Mitglieder feldgefiltert je nach Rolle)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(user, id);
  }

  @Post()
  @RequireAdmin()
  @ApiOperation({ summary: 'Team anlegen (nur Admin)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTeamDto) {
    return this.teams.create(user, dto);
  }

  @Patch(':id')
  @RequireAdmin()
  @ApiOperation({ summary: 'Team ändern (nur Admin)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teams.update(user, id, dto);
  }

  @Delete(':id')
  @RequireAdmin()
  @HttpCode(204)
  @ApiOperation({ summary: 'Team löschen (nur Admin)' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.teams.delete(user, id);
  }

  // --- Mitglieder (Admin oder Leiter dieses Teams) -----------

  @Post(':id/members')
  @ApiOperation({ summary: 'Mitglied hinzufügen (Admin oder Teamleiter dieses Teams)' })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.teams.addMember(user, id, dto);
  }

  @Patch(':id/members/:personId')
  @ApiOperation({ summary: 'Teamrolle eines Mitglieds ändern (LEADER nur durch Admin)' })
  setMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.teams.setMemberRole(user, id, personId, dto.role);
  }

  @Delete(':id/members/:personId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mitglied entfernen (Admin oder Teamleiter dieses Teams)' })
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
  ): Promise<void> {
    await this.teams.removeMember(user, id, personId);
  }

  // --- Rechtematrix (Admin oder Leiter dieses Teams) ----------

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Rechtematrix des Teams (gemergte Sicht inkl. Defaults)' })
  getPermissions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.getPermissionMatrix(user, id);
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Rechtematrix des Teams setzen (Admin oder Leiter)' })
  setPermissions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPermissionsDto,
  ) {
    return this.teams.setPermissionMatrix(user, id, dto);
  }

  // --- Positionen ---------------------------------------------

  @Post(':id/positions')
  @ApiOperation({ summary: 'Position anlegen (Admin oder Teamleiter dieses Teams)' })
  createPosition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePositionDto,
  ) {
    return this.teams.createPosition(user, id, dto.name);
  }
}

// Positions-/Skill-Routen unter eigenem Pfad, weil sie über die
// Positions-ID adressiert werden (das Team ergibt sich daraus).
@ApiTags('teams')
@Controller('positions')
export class PositionsController {
  constructor(private readonly teams: TeamsService) {}

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Position löschen (Admin oder Teamleiter des Teams)' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.teams.deletePosition(user, id);
  }

  @Put(':id/skills/:personId')
  @ApiOperation({ summary: 'Person mit Skill-Level zuordnen (Admin oder Teamleiter)' })
  setSkill(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: SetSkillDto,
  ) {
    return this.teams.setSkill(user, id, personId, dto.skillLevel);
  }

  @Delete(':id/skills/:personId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Positions-Zuordnung entfernen (Admin oder Teamleiter)' })
  async removeSkill(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
  ): Promise<void> {
    await this.teams.removeSkill(user, id, personId);
  }
}
