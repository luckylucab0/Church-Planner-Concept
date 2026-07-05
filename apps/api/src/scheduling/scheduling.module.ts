import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController, ServiceTypesController } from './scheduling.controller';
import { ServiceTypesService } from './service-types.service';

@Module({
  controllers: [ServiceTypesController, EventsController],
  providers: [ServiceTypesService, EventsService],
  exports: [EventsService],
})
export class SchedulingModule {}
