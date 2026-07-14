-- Einmal-Backup-Codes für 2FA: nur SHA-256-Hashes, single-use via usedAt.

-- CreateTable
CREATE TABLE "TotpBackupCode" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TotpBackupCode_codeHash_key" ON "TotpBackupCode"("codeHash");

-- CreateIndex
CREATE INDEX "TotpBackupCode_accountId_idx" ON "TotpBackupCode"("accountId");

-- AddForeignKey
ALTER TABLE "TotpBackupCode" ADD CONSTRAINT "TotpBackupCode_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
