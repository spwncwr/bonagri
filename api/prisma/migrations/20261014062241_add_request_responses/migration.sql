-- CreateEnum
CREATE TYPE "RequestResponseStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "RequestResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "quotedPrice" DECIMAL(12,2),
    "quotedUnit" TEXT,
    "status" "RequestResponseStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestResponse_supplierId_idx" ON "RequestResponse"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestResponse_requestId_supplierId_key" ON "RequestResponse"("requestId", "supplierId");

-- AddForeignKey
ALTER TABLE "RequestResponse" ADD CONSTRAINT "RequestResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProductRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestResponse" ADD CONSTRAINT "RequestResponse_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
