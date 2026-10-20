-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONFIRMED_LAZY', 'DISPUTED');

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "handoverAt" TIMESTAMP(3),
ADD COLUMN     "receiptAt" TIMESTAMP(3),
ADD COLUMN     "receiptNote" TEXT,
ADD COLUMN     "receiptStatus" "ReceiptStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DeliveryCheckpoint" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "type" "CheckpointType" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "clientAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photoId" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,

    CONSTRAINT "DeliveryCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPhoto" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryCheckpoint_deliveryId_recordedAt_idx" ON "DeliveryCheckpoint"("deliveryId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPhoto_sha256_key" ON "DeliveryPhoto"("sha256");

-- AddForeignKey
ALTER TABLE "DeliveryCheckpoint" ADD CONSTRAINT "DeliveryCheckpoint_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCheckpoint" ADD CONSTRAINT "DeliveryCheckpoint_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "DeliveryPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
