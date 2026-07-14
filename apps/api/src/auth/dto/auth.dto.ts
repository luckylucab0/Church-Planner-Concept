import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@example.org' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password: string;

  @ApiPropertyOptional({
    description: '6-stelliger TOTP-Code oder Backup-Code (XXXX-XXXX), falls 2FA aktiv',
  })
  @IsOptional()
  @IsString()
  @Length(6, 9)
  totpCode?: string;
}

export class TotpVerifyDto {
  @ApiProperty({ description: '6-stelliger Code aus der Authenticator-App' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class TotpDisableDto {
  @ApiProperty({ description: 'Aktuelles Passwort als Nachweis' })
  @IsString()
  @MaxLength(200)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword: string;
}

export class PasswordResetRequestDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword: string;
}
