import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
}

export class UpdateSongDto extends PartialType(CreateSongDto) {}

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
