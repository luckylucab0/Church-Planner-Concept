-- CreateEnum
CREATE TYPE "ServicePlanItemKind" AS ENUM ('SONG', 'SERMON', 'MODERATION', 'PRAYER', 'COMMUNION', 'ANNOUNCEMENTS', 'OFFERING', 'BLESSING', 'BAPTISM', 'VIDEO', 'BREAK', 'OTHER');

-- AlterTable
ALTER TABLE "ServicePlanItem" ADD COLUMN "kind" "ServicePlanItemKind" NOT NULL DEFAULT 'OTHER';

-- Bestehende Punkte mit verknüpftem Lied sind offensichtlich Lieder. Ohne
-- diesen Backfill stünden alle Altdaten auf "Sonstiges" und der Editor würde
-- die Lied-Auswahl nicht mehr anbieten.
UPDATE "ServicePlanItem" SET "kind" = 'SONG' WHERE "songId" IS NOT NULL;
