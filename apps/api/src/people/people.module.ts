import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { NotesService } from './notes.service';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // SessionService: Rollenwechsel meldet die Person ab
  controllers: [PeopleController, MeController],
  providers: [PeopleService, NotesService],
  exports: [PeopleService],
})
export class PeopleModule {}
