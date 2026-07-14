import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CreateUserRequestDto,
  ListUserRequestsQueryDto,
  ReviewUserRequestDto,
} from './dto/user-requests.dto';
import { UserRequestsService } from './user-requests.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequireAdmin } from '../auth/decorators';

@ApiTags('user-requests')
@Controller('user-requests')
export class UserRequestsController {
  constructor(private readonly userRequests: UserRequestsService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Benutzer beantragen (Teamleiter für ihr Team)' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserRequestDto) {
    return this.userRequests.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Anträge auflisten (Admin: alle, sonst eigene)' })
  async list(@CurrentUser() user: AuthUser, @Query() query: ListUserRequestsQueryDto) {
    return this.userRequests.list(user, query.status);
  }

  @RequireAdmin()
  @Post(':id/approve')
  @HttpCode(204)
  @ApiOperation({ summary: 'Antrag genehmigen: Person + Team-Mitgliedschaft + Einladung' })
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewUserRequestDto,
  ): Promise<void> {
    await this.userRequests.approve(user, id, dto.comment);
  }

  @RequireAdmin()
  @Post(':id/reject')
  @HttpCode(204)
  @ApiOperation({ summary: 'Antrag ablehnen (optionaler Kommentar)' })
  async reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewUserRequestDto,
  ): Promise<void> {
    await this.userRequests.reject(user, id, dto.comment);
  }
}
