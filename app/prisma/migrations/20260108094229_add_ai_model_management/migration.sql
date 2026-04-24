-- CreateEnum
CREATE TYPE "AICategory" AS ENUM ('LLM', 'IMAGE', 'VIDEO', 'TTS');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING');

-- CreateEnum
CREATE TYPE "ConcurrencyMode" AS ENUM ('SERIAL', 'PARALLEL');

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "AICategory" NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT,
    "models" JSONB NOT NULL,
    "configSchema" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAIConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiKeyIv" TEXT NOT NULL,
    "extraConfig" JSONB,
    "selectedModel" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "testStatus" "TestStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAIConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGenerationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultLLM" TEXT,
    "defaultImage" TEXT,
    "defaultVideo" TEXT,
    "defaultTTS" TEXT,
    "concurrencyMode" "ConcurrencyMode" NOT NULL DEFAULT 'PARALLEL',
    "maxConcurrent" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGenerationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIProvider_slug_key" ON "AIProvider"("slug");

-- CreateIndex
CREATE INDEX "UserAIConfig_userId_idx" ON "UserAIConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAIConfig_userId_providerId_key" ON "UserAIConfig"("userId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserGenerationPreference_userId_key" ON "UserGenerationPreference"("userId");

-- AddForeignKey
ALTER TABLE "UserAIConfig" ADD CONSTRAINT "UserAIConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAIConfig" ADD CONSTRAINT "UserAIConfig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AIProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGenerationPreference" ADD CONSTRAINT "UserGenerationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
