import { Module } from '@nestjs/common';
import {
  AssignmentsController,
  MyAssignmentsController,
  RespondController,
} from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import {
  MyReplacementController,
  ReplacementTokenController,
  SignupController,
} from './replacement.controller';
import { ReplacementService } from './replacement.service';
import { SignupService } from './signup.service';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [AvailabilityModule],
  controllers: [
    AssignmentsController,
    RespondController,
    MyAssignmentsController,
    MyReplacementController,
    ReplacementTokenController,
    SignupController,
  ],
  providers: [AssignmentsService, ReplacementService, SignupService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
