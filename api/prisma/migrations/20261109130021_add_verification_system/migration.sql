/*
  Warnings:

  - A unique constraint covering the columns `[latestApplicationId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VerificationAction" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'STARTED_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VerificationDocumentKind" AS ENUM ('BUSINESS_REGISTRATION', 'BUSINESS_LICENCE', 'AGRICULTURAL_INPUT_LICENCE', 'PROOF_OF_BUSINESS_ADDRESS', 'OWNER_ID', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "businessStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "businessVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "latestApplicationId" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PhoneOtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "businessName" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "physicalAddress" TEXT NOT NULL,
    "representativeName" TEXT NOT NULL,
    "details" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNotes" TEXT,
    "rejectionReason" TEXT,
    "infoRequest" TEXT,

    CONSTRAINT "VerificationApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "VerificationDocumentKind" NOT NULL,
    "publicId" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAuditLog" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "VerificationAction" NOT NULL,
    "fromStatus" "VerificationStatus",
    "toStatus" "VerificationStatus",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneOtpCode_codeHash_key" ON "PhoneOtpCode"("codeHash");

-- CreateIndex
CREATE INDEX "PhoneOtpCode_userId_idx" ON "PhoneOtpCode"("userId");

-- CreateIndex
CREATE INDEX "PhoneOtpCode_expiresAt_idx" ON "PhoneOtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "VerificationApplication_status_submittedAt_idx" ON "VerificationApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationApplication_userId_idx" ON "VerificationApplication"("userId");

-- CreateIndex
CREATE INDEX "VerificationDocument_applicationId_idx" ON "VerificationDocument"("applicationId");

-- CreateIndex
CREATE INDEX "VerificationAuditLog_applicationId_createdAt_idx" ON "VerificationAuditLog"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_latestApplicationId_key" ON "User"("latestApplicationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_latestApplicationId_fkey" FOREIGN KEY ("latestApplicationId") REFERENCES "VerificationApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneOtpCode" ADD CONSTRAINT "PhoneOtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "VerificationApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAuditLog" ADD CONSTRAINT "VerificationAuditLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "VerificationApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAuditLog" ADD CONSTRAINT "VerificationAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
