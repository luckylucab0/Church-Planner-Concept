import { Module } from '@nestjs/common';
import { UserRequestsController } from './user-requests.controller';
import { UserRequestsService } from './user-requests.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // InviteService für den Genehmigungs-Flow
  controllers: [UserRequestsController],
  providers: [UserRequestsService],
})
export class UserRequestsModule {}
