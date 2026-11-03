-- CreateEnum
CREATE TYPE "PromoCampaignType" AS ENUM ('FEATURED_PRODUCTS', 'NEAR_YOU', 'SPECIAL_OFFERS', 'DISCOVER_CATEGORIES', 'FEATURED_SHOPS');

-- CreateEnum
CREATE TYPE "PromoCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PromoCampaignPlacement" AS ENUM ('HOME_TOP', 'HOME_MID', 'EXPLORE_TOP', 'EXPLORE_MID');

-- CreateEnum
CREATE TYPE "PromoCardLayout" AS ENUM ('BANNER', 'SPLIT', 'COMPACT', 'EDITORIAL', 'CAROUSEL');

-- CreateEnum
CREATE TYPE "PromoDestinationType" AS ENUM ('PRODUCT', 'CATEGORY', 'SHOP', 'NONE');

-- CreateEnum
CREATE TYPE "PromoEventType" AS ENUM ('IMPRESSION', 'CLICK');

-- CreateTable
CREATE TABLE "PromoCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromoCampaignType" NOT NULL,
    "status" "PromoCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "layout" "PromoCardLayout" NOT NULL DEFAULT 'BANNER',
    "placement" "PromoCampaignPlacement" NOT NULL DEFAULT 'HOME_TOP',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "ctaText" TEXT NOT NULL DEFAULT 'View offer',
    "tone" TEXT DEFAULT 'from-[#17633a] to-[#0c3f23]',
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "destinationType" "PromoDestinationType" NOT NULL DEFAULT 'NONE',
    "destinationProductId" TEXT,
    "destinationCategoryId" TEXT,
    "destinationSupplierId" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCampaignImage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PromoCampaignImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCampaignProduct" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "promoPrice" DECIMAL(12,2),

    CONSTRAINT "PromoCampaignProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "PromoEventType" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoCampaign_status_placement_priority_idx" ON "PromoCampaign"("status", "placement", "priority");

-- CreateIndex
CREATE INDEX "PromoCampaign_startAt_expiresAt_idx" ON "PromoCampaign"("startAt", "expiresAt");

-- CreateIndex
CREATE INDEX "PromoCampaignImage_campaignId_sortOrder_idx" ON "PromoCampaignImage"("campaignId", "sortOrder");

-- CreateIndex
CREATE INDEX "PromoCampaignProduct_productId_idx" ON "PromoCampaignProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCampaignProduct_campaignId_productId_key" ON "PromoCampaignProduct"("campaignId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCampaignEvent_eventKey_key" ON "PromoCampaignEvent"("eventKey");

-- CreateIndex
CREATE INDEX "PromoCampaignEvent_campaignId_type_createdAt_idx" ON "PromoCampaignEvent"("campaignId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "PromoCampaignImage" ADD CONSTRAINT "PromoCampaignImage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromoCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCampaignProduct" ADD CONSTRAINT "PromoCampaignProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromoCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCampaignProduct" ADD CONSTRAINT "PromoCampaignProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCampaignEvent" ADD CONSTRAINT "PromoCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromoCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
