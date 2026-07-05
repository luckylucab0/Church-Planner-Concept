import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { NotesService } from './notes.service';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

@Module({
  controllers: [PeopleController, MeController],
  providers: [PeopleService, NotesService],
  exports: [PeopleService],
})
export class PeopleModule {}
