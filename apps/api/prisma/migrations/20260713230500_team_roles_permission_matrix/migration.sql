-- Teamrollen (LEADER/DEPUTY/MEMBER/INTERN) ersetzen das isLeader-Flag,
-- plus konfigurierbare Rechtematrix pro Team und Rolle.

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEADER', 'DEPUTY', 'MEMBER', 'INTERN');

-- CreateEnum
CREATE TYPE "TeamCapability" AS ENUM ('ASSIGN', 'OPEN_SIGNUP', 'MANAGE_MEMBERS', 'MANAGE_POSITIONS', 'NOTES', 'VIEW_CONTACTS', 'VIEW_DRAFTS', 'EDIT_PLAN', 'MANAGE_SONGS');

-- AlterTable: erst neue Spalte, dann Datenübernahme, erst danach die alte
-- Spalte droppen – bestehende Leiter dürfen nicht verloren gehen.
ALTER TABLE "TeamMembership" ADD COLUMN "role" "TeamRole" NOT NULL DEFAULT 'MEMBER';

UPDATE "TeamMembership" SET "role" = 'LEADER' WHERE "isLeader";

ALTER TABLE "TeamMembership" DROP COLUMN "isLeader";

-- CreateTable
CREATE TABLE "TeamRolePermission" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "role" "TeamRole" NOT NULL,
    "capability" "TeamCapability" NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "TeamRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamRolePermission_teamId_idx" ON "TeamRolePermission"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRolePermission_teamId_role_capability_key" ON "TeamRolePermission"("teamId", "role", "capability");

-- AddForeignKey
ALTER TABLE "TeamRolePermission" ADD CONSTRAINT "TeamRolePermission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
