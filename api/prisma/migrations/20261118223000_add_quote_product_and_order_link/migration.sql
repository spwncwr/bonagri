-- AlterTable (F1): quotes become product-backed and carry a conversion
-- guard — productId links the quoted listing, orderId is set exactly once
-- when the accepted quote becomes an order (@unique blocks double-orders).
ALTER TABLE "RequestResponse"
    ADD COLUMN "orderId" TEXT,
    ADD COLUMN "productId" TEXT;

-- CreateIndex
CREATE INDEX "RequestResponse_productId_idx" ON "RequestResponse"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestResponse_orderId_key" ON "RequestResponse"("orderId");

-- AddForeignKey
ALTER TABLE "RequestResponse" ADD CONSTRAINT "RequestResponse_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
