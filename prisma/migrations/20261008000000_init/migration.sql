-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecyclingFeeSettings" (
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mattressProductTypes" JSONB NOT NULL DEFAULT '["Mattresses"]',
    "feeProductId" TEXT,
    "feeVariantId" TEXT,
    "noticeTitle" TEXT NOT NULL DEFAULT 'Mattress Recycling Fee',
    "explanation" TEXT NOT NULL DEFAULT 'A state-mandated recycling fee may apply to each mattress, foundation, or bed frame in applicable states. The fee supports state mattress recycling programs.',
    "noticeLinkText" TEXT NOT NULL DEFAULT 'Learn more about mattress recycling',
    "noticeLinkUrl" TEXT NOT NULL DEFAULT 'https://egohome.com/pages/mattress-recycling-fee',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecyclingFeeSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "RecyclingFeeRate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "stateName" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "sku" TEXT,
    "variantId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecyclingFeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecyclingFeeRate_shop_idx" ON "RecyclingFeeRate"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RecyclingFeeRate_shop_stateCode_key" ON "RecyclingFeeRate"("shop", "stateCode");
