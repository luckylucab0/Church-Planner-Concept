-- AlterTable
ALTER TABLE "ServicePlanItem" ADD COLUMN     "arrangementId" UUID;

-- AddForeignKey
ALTER TABLE "ServicePlanItem" ADD CONSTRAINT "ServicePlanItem_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlanItem" ADD CONSTRAINT "ServicePlanItem_arrangementId_fkey" FOREIGN KEY ("arrangementId") REFERENCES "SongArrangement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
