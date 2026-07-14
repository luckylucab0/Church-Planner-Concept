-- CreateEnum
CREATE TYPE "UserAccountRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'INVITE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'INVITE';
ALTER TYPE "NotificationKind" ADD VALUE 'USER_REQUEST';
ALTER TYPE "NotificationKind" ADD VALUE 'USER_REQUEST_RESULT';

-- CreateTable
CREATE TABLE "UserAccountRequest" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "teamId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "UserAccountRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewComment" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdPersonId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAccountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAccountRequest_status_idx" ON "UserAccountRequest"("status");

-- CreateIndex
CREATE INDEX "UserAccountRequest_requestedById_idx" ON "UserAccountRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "UserAccountRequest" ADD CONSTRAINT "UserAccountRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccountRequest" ADD CONSTRAINT "UserAccountRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

