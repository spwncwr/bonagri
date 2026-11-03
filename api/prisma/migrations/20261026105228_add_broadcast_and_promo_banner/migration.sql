-- CreateTable
CREATE TABLE "NotificationBroadcast" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "sentEmail" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "eyebrow" TEXT,
    "ctaText" TEXT DEFAULT 'Learn more',
    "ctaLink" TEXT NOT NULL DEFAULT '/explore',
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "tone" TEXT DEFAULT 'from-[#17633a] to-[#0c3f23]',
    "targetRole" TEXT DEFAULT 'ALL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationBroadcast_createdAt_idx" ON "NotificationBroadcast"("createdAt");

-- CreateIndex
CREATE INDEX "PromoBanner_isActive_sortOrder_idx" ON "PromoBanner"("isActive", "sortOrder");
