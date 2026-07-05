import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Datenminimierung: nur Felder, die für die Diensteinteilung nötig sind.
// Alles außer dem Namen ist optional.
export class CreatePersonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ description: 'ISO-Datum (optional)' })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ enum: ['de', 'en'] })
  @IsOptional()
  @IsIn(['de', 'en'])
  locale?: string;
}

export class UpdatePersonDto extends PartialType(CreatePersonDto) {}

// Eigenes Profil: dieselben Felder wie UpdatePersonDto, aber ohne Namen –
// Namensänderungen laufen über Admins (verhindert Verwirrung in Plänen)
export class UpdateMeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ enum: ['de', 'en'] })
  @IsOptional()
  @IsIn(['de', 'en'])
  locale?: string;
}

export class UpdatePrivacyDto {
  @ApiProperty()
  @IsBoolean()
  emailVisibleToTeam: boolean;

  @ApiProperty()
  @IsBoolean()
  phoneVisibleToTeam: boolean;

  @ApiProperty()
  @IsBoolean()
  birthdayVisibleToTeam: boolean;

  @ApiProperty()
  @IsBoolean()
  photoVisibleToMembers: boolean;
}

export class CreateNoteDto {
  @ApiProperty({ enum: ['GENERAL', 'PASTORAL'] })
  @IsIn(['GENERAL', 'PASTORAL'])
  kind: 'GENERAL' | 'PASTORAL';

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  content: string;
}
