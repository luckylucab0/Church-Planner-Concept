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
  setTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTemplateDto) {
    return this.serviceTypes.setTemplate(id, dto);
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
    return this.events.list(user, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dienstplan eines Termins (Slots, Personen, Status)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(user, id);
  }

  @Post()
  @RequireAdmin()
  @ApiOperation({ summary: 'Einzeltermin anlegen (Slots optional aus Typ-Template)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.events.create(user, dto);
  }

  @Patch(':id')
  @RequireAdmin()
  @ApiOperation({ summary: 'Termin ändern (inkl. Veröffentlichen/Absagen via status)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.update(user, id, dto);
  }

  @Delete(':id')
  @RequireAdmin()
  @HttpCode(204)
  @ApiOperation({ summary: 'Termin löschen' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.events.delete(user, id);
  }

  @Put(':id/slots')
  @RequireAdmin()
  @ApiOperation({ summary: 'Benötigte Positionen dieses Termins anpassen' })
  setSlots(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSlotsDto) {
    return this.events.setSlots(id, dto);
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
