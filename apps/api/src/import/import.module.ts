import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { PcoApiClient } from './pco-api.client';

@Module({
  controllers: [ImportController],
  providers: [ImportService, PcoApiClient],
})
export class ImportModule {}
