import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSongDto {
  @ApiProperty({ example: 'In Christus ist mein ganzer Halt' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'D', description: 'Standard-Tonart' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultKey?: string;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(300)
  tempoBpm?: number;

  @ApiPropertyOptional({ example: '3350395', description: 'CCLI-Liednummer' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ccliNumber?: string;

  @ApiPropertyOptional({ example: 'Keith Getty | Stuart Townend' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  author?: string;

  @ApiPropertyOptional({ example: '© 2001 Thankyou Music' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  copyright?: string;

  @ApiPropertyOptional({ description: 'Songtext/ChordPro-Quelle' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  lyrics?: string;
}

export class UpdateSongDto extends PartialType(CreateSongDto) {}

export class ImportSongDto {
  // Dateiinhalt als Text im JSON-Body – gleiches Muster wie der
  // CSV-Import (kein Multipart nötig, die UI liest die Datei clientseitig)
  @ApiProperty({ description: 'Dateiinhalt (ChordPro oder SongSelect-Text)' })
  @IsString()
  @MaxLength(5_000_000)
  content: string;

  @ApiProperty({ example: 'in-christ-alone.cho' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiPropertyOptional({
    description: 'Bestehendes Lied mit gleicher CCLI-Nummer überschreiben',
  })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

export class CcliReportQueryDto {
  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  to: string;
}

export class CcliLicenseDto {
  @ApiProperty({ example: '123456', description: 'CCLI-Lizenznummer der Gemeinde' })
  @IsString()
  @MaxLength(50)
  licenseNumber: string;
}

export class CreateArrangementDto {
  @ApiProperty({ example: 'Akustik' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'C', description: 'Tonart dieses Arrangements' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  key?: string;
}

export class UpdateArrangementDto extends PartialType(CreateArrangementDto) {}
