-- CreateEnum
CREATE TYPE "ReplacementStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'REPLACEMENT_REQUEST';
ALTER TYPE "NotificationKind" ADD VALUE 'REPLACEMENT_RESULT';
ALTER TYPE "NotificationKind" ADD VALUE 'SIGNUP_ALERT';

-- AlterTable
ALTER TABLE "EventPositionSlot" ADD COLUMN     "openForSignup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReplacementRequest" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "candidatePersonId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "ReplacementStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplacementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplacementRequest_tokenHash_key" ON "ReplacementRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "ReplacementRequest_assignmentId_idx" ON "ReplacementRequest"("assignmentId");

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_candidatePersonId_fkey" FOREIGN KEY ("candidatePersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
