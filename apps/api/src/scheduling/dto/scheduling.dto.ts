import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateServiceTypeDto {
  @ApiProperty({ example: 'Gottesdienst' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: 'FREQ=WEEKLY;BYDAY=SU',
    description: 'RFC-5545-RRULE für wiederkehrende Termine',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rrule?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 'Hauptsaal' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}

export class UpdateServiceTypeDto extends PartialType(CreateServiceTypeDto) {}

export class TemplateItemDto {
  @ApiProperty()
  @IsUUID()
  positionId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(50)
  requiredCount: number;
}

export class SetTemplateDto {
  @ApiProperty({ type: [TemplateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items: TemplateItemDto[];
}

export class GenerateEventsDto {
  @ApiProperty({ description: 'Termine bis zu diesem Datum materialisieren (ISO)' })
  @IsDateString()
  until: string;
}

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty()
  @IsDateString()
  startsAt: string;

  @ApiProperty()
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ description: 'Slots aus dem Template dieses Typs übernehmen' })
  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;
}

export class UpdateEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ enum: ['PLANNED', 'PUBLISHED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['PLANNED', 'PUBLISHED', 'CANCELLED'])
  status?: 'PLANNED' | 'PUBLISHED' | 'CANCELLED';
}

export class SetSlotsDto {
  @ApiProperty({ type: [TemplateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items: TemplateItemDto[];
}
