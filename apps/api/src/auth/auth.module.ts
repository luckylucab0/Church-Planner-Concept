import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InviteService } from './invite.service';
import { SessionService } from './session.service';
import { BackupCodesService } from './backup-codes.service';
import { TotpService } from './totp.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, InviteService, SessionService, TotpService, BackupCodesService],
  exports: [SessionService, InviteService],
})
export class AuthModule {}
