import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TeamCapability, TeamRole } from '@prisma/client';

const TEAM_ROLES: TeamRole[] = ['LEADER', 'DEPUTY', 'MEMBER', 'INTERN'];
// LEADER ist in der Matrix nicht konfigurierbar (implizit alles)
const CONFIGURABLE_TEAM_ROLES: TeamRole[] = ['DEPUTY', 'MEMBER', 'INTERN'];
const TEAM_CAPABILITY_VALUES: TeamCapability[] = [
  'ASSIGN',
  'OPEN_SIGNUP',
  'MANAGE_MEMBERS',
  'MANAGE_POSITIONS',
  'NOTES',
  'VIEW_CONTACTS',
  'VIEW_DRAFTS',
  'EDIT_PLAN',
  'MANAGE_SONGS',
];

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

  @ApiPropertyOptional({
    enum: TEAM_ROLES,
    description: 'Teamrolle – LEADER kann nur ein Admin vergeben',
  })
  @IsOptional()
  @IsIn(TEAM_ROLES)
  role?: TeamRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: TEAM_ROLES, description: 'LEADER kann nur ein Admin vergeben/entziehen' })
  @IsIn(TEAM_ROLES)
  role: TeamRole;
}

export class PermissionEntryDto {
  @ApiProperty({ enum: CONFIGURABLE_TEAM_ROLES })
  @IsIn(CONFIGURABLE_TEAM_ROLES)
  role: 'DEPUTY' | 'MEMBER' | 'INTERN';

  @ApiProperty({ enum: TEAM_CAPABILITY_VALUES })
  @IsIn(TEAM_CAPABILITY_VALUES)
  capability: TeamCapability;

  @ApiProperty()
  @IsBoolean()
  allowed: boolean;
}

export class SetPermissionsDto {
  @ApiProperty({ type: [PermissionEntryDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PermissionEntryDto)
  entries: PermissionEntryDto[];
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
