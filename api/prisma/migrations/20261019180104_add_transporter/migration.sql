-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'TRANSPORTER';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failedReason" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "transporterId" TEXT;

-- CreateTable
CREATE TABLE "TransporterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "vehicleType" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "province" TEXT,
    "serviceProvinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransporterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransporterProfile_userId_key" ON "TransporterProfile"("userId");

-- CreateIndex
CREATE INDEX "TransporterProfile_businessName_idx" ON "TransporterProfile"("businessName");

-- CreateIndex
CREATE INDEX "TransporterProfile_province_idx" ON "TransporterProfile"("province");

-- CreateIndex
CREATE INDEX "TransporterProfile_verified_idx" ON "TransporterProfile"("verified");

-- CreateIndex
CREATE INDEX "Delivery_transporterId_idx" ON "Delivery"("transporterId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "TransporterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransporterProfile" ADD CONSTRAINT "TransporterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
