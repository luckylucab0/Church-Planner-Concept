import { Module } from '@nestjs/common';
import { PositionsController, TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  controllers: [TeamsController, PositionsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
