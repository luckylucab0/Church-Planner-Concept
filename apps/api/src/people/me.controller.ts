import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateMeDto, UpdatePrivacyDto } from './dto/people.dto';
import { PeopleService } from './people.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';

// Selbstbedienung: eigenes Profil, Privacy-Einstellungen, Datenexport.
// Bewusst getrennt von /people – hier gibt es keine Fremd-IDs, also auch
// keine IDOR-Fläche.
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  @ApiOperation({ summary: 'Eigenes Profil' })
  me(@CurrentUser() user: AuthUser) {
    return this.people.get(user, user.personId);
  }

  @Patch()
  @ApiOperation({ summary: 'Eigene Kontaktdaten ändern' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.people.updateMe(user, dto);
  }

  @Get('privacy')
  @ApiOperation({ summary: 'Eigene Sichtbarkeits-Einstellungen' })
  privacy(@CurrentUser() user: AuthUser) {
    return this.people.getPrivacy(user);
  }

  @Put('privacy')
  @ApiOperation({ summary: 'Sichtbarkeit der eigenen Kontaktdaten steuern' })
  updatePrivacy(@CurrentUser() user: AuthUser, @Body() dto: UpdatePrivacyDto) {
    return this.people.updatePrivacy(user, dto);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export der eigenen Daten (DSGVO Art. 15/20)' })
  export(@CurrentUser() user: AuthUser) {
    return this.people.exportData(user, user.personId);
  }
}
