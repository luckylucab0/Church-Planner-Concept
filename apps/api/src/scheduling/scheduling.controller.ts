import {
  BadRequestException,
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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateEventDto,
  CreateServiceTypeDto,
  GenerateEventsDto,
  SetPlanDto,
  SetSlotsDto,
  SetTemplateDto,
  UpdateEventDto,
  UpdateServiceTypeDto,
} from './dto/scheduling.dto';
import { EventsService } from './events.service';
import { ServiceTypesService } from './service-types.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequireAdmin } from '../auth/decorators';

@ApiTags('service-types')
@Controller('service-types')
export class ServiceTypesController {
  constructor(private readonly serviceTypes: ServiceTypesService) {}

  @Get()
  @ApiOperation({ summary: 'Gottesdienst-Typen mit Positions-Template' })
  list() {
    return this.serviceTypes.list();
  }

  @Post()
  @RequireAdmin()
  @ApiOperation({ summary: 'Typ anlegen (RRULE für wiederkehrende Termine)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceTypeDto) {
    return this.serviceTypes.create(user, dto);
  }

  @Patch(':id')
  @RequireAdmin()
  @ApiOperation({ summary: 'Typ ändern' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceTypeDto,
  ) {
    return this.serviceTypes.update(user, id, dto);
  }

  @Delete(':id')
  @RequireAdmin()
  @HttpCode(204)
  @ApiOperation({ summary: 'Typ löschen (bestehende Termine bleiben)' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.serviceTypes.delete(user, id);
  }

  @Put(':id/template')
  @RequireAdmin()
  @ApiOperation({ summary: 'Benötigte Positionen pro Termin definieren' })
  setTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTemplateDto,
  ) {
    return this.serviceTypes.setTemplate(user, id, dto);
  }

  @Post(':id/generate')
  @RequireAdmin()
  @ApiOperation({ summary: 'Termine aus der RRULE materialisieren (idempotent)' })
  generate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateEventsDto,
  ) {
    return this.serviceTypes.generateEvents(user, id, new Date(dto.until));
  }
}

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Termine im Zeitraum (Mitglieder: nur veröffentlichte)' })
  list(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    // Ohne Prüfung landet ein "Invalid Date" in der Prisma-Query und
    // erzeugt einen HTTP 500 – ein Tippfehler im Query-String ist aber ein
    // Client-Fehler und gehört mit 400 beantwortet.
    return this.events.list(user, parseDateParam(from, 'from'), parseDateParam(to, 'to'));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dienstplan eines Termins (Slots, Personen, Status)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(user, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Einzeltermin anlegen (Recht „Termine verwalten“; Slots optional aus Typ-Template)',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.events.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Termin ändern (Recht „Termine verwalten“; inkl. Veröffentlichen/Absagen via status)',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.update(user, id, dto);
  }

  // Löschen bleibt Admin-Sache: es räumt Slots, Einteilungen und Ablaufplan
  // per Cascade ab. Wer nur MANAGE_EVENTS hat, sagt stattdessen ab.
  @Delete(':id')
  @RequireAdmin()
  @HttpCode(204)
  @ApiOperation({ summary: 'Termin löschen (nur Admin)' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.events.delete(user, id);
  }

  @Put(':id/slots')
  @ApiOperation({
    summary: 'Benötigte Positionen dieses Termins anpassen (Recht „Termine verwalten“)',
  })
  setSlots(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSlotsDto,
  ) {
    return this.events.setSlots(user, id, dto);
  }

  @Put(':id/plan')
  @ApiOperation({ summary: 'Ablaufplan dieses Termins ersetzen (Admin oder Teamleiter)' })
  setPlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPlanDto,
  ) {
    return this.events.setPlan(user, id, dto);
  }
}

// Wandelt einen optionalen Datums-Query-Parameter in ein Date um und lehnt
// unparsbare Werte mit 400 ab, statt ein "Invalid Date" in die Datenbank-
// Query durchzureichen (dort endete es als HTTP 500).
function parseDateParam(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Ungültiges Datum im Parameter "${name}": ${value}`);
  }
  return date;
}
