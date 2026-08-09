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
// Eine Quelle für die Capability-Liste: sonst kann eine neue Capability in
// der Matrix auftauchen, die das DTO als ungültig zurückweist.
import { TEAM_CAPABILITIES } from '../../authz/team-capabilities';

const TEAM_ROLES: TeamRole[] = ['LEADER', 'DEPUTY', 'MEMBER', 'INTERN'];
// LEADER ist in der Matrix nicht konfigurierbar (implizit alles)
const CONFIGURABLE_TEAM_ROLES: TeamRole[] = ['DEPUTY', 'MEMBER', 'INTERN'];

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

  @ApiProperty({ enum: TEAM_CAPABILITIES })
  @IsIn(TEAM_CAPABILITIES)
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
