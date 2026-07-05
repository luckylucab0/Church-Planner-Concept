import { Controller, Get, Header, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CalendarService } from './calendar.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';

@ApiTags('calendar')
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // Persönlicher iCal-Feed als Abo-URL für Google/Apple Calendar.
  // Public per geheimem Token (128 Bit) – Kalender-Apps können sich
  // nicht einloggen. Der Feed enthält nur die eigenen Dienste.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('ical/:token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @ApiOperation({ summary: 'iCal-Feed der eigenen Dienste (Abo-URL)' })
  async feed(@Param('token') token: string): Promise<string> {
    // Kalender-Apps hängen teils .ics an – tolerant abschneiden
    const cleaned = token.endsWith('.ics') ? token.slice(0, -4) : token;
    const feed = await this.calendar.buildFeed(cleaned);
    if (!feed) throw new NotFoundException();
    return feed;
  }

  @Get('me/ical-token')
  @ApiOperation({ summary: 'Status des eigenen Kalender-Feeds' })
  status(@CurrentUser() user: AuthUser) {
    return this.calendar.status(user.personId);
  }

  // POST statt GET: erzeugt/rotiert den Token. Die URL mit Klartext-Token
  // gibt es nur in dieser Response – gespeichert wird nur der Hash.
  @Post('me/ical-token')
  @ApiOperation({ summary: 'Kalender-Feed-URL erzeugen oder rotieren' })
  rotate(@CurrentUser() user: AuthUser) {
    return this.calendar.rotateToken(user.personId);
  }
}
