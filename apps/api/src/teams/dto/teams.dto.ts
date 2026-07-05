import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'Worship' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: '#8b5cf6' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;
}

export class UpdateTeamDto extends PartialType(CreateTeamDto) {}

export class AddMemberDto {
  @ApiProperty()
  @IsUUID()
  personId: string;

  @ApiPropertyOptional({ description: 'Teamleiter-Flag – kann nur ein Admin setzen' })
  @IsOptional()
  @IsBoolean()
  isLeader?: boolean;
}

export class CreatePositionDto {
  @ApiProperty({ example: 'Gitarre' })
  @IsString()
  @MaxLength(100)
  name: string;
}

export class SetSkillDto {
  @ApiProperty({ enum: ['BEGINNER', 'SOLID', 'EXPERT'] })
  @IsIn(['BEGINNER', 'SOLID', 'EXPERT'])
  skillLevel: 'BEGINNER' | 'SOLID' | 'EXPERT';
}
