-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imagePublicId" TEXT;

-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "logoPublicId" TEXT,
ADD COLUMN     "logoUrl" TEXT;
