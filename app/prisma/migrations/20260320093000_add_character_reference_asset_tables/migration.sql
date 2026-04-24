-- CreateTable
CREATE TABLE IF NOT EXISTS "CharacterAppearance" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "hairStyle" TEXT,
    "hairColor" TEXT,
    "faceShape" TEXT,
    "eyeColor" TEXT,
    "bodyType" TEXT,
    "height" TEXT,
    "skinTone" TEXT,
    "clothingPresets" JSONB,
    "accessories" TEXT,
    "freeText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CharacterReferenceAsset" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'upload',
    "isCanonical" BOOLEAN NOT NULL DEFAULT false,
    "pose" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterReferenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CharacterFaceEmbedding" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "modelVersion" TEXT NOT NULL,
    "sourceAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterFaceEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CharacterAppearance_characterId_key" ON "CharacterAppearance"("characterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CharacterReferenceAsset_characterId_idx" ON "CharacterReferenceAsset"("characterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CharacterFaceEmbedding_characterId_idx" ON "CharacterFaceEmbedding"("characterId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'CharacterAppearance_characterId_fkey'
    ) THEN
        ALTER TABLE "CharacterAppearance"
        ADD CONSTRAINT "CharacterAppearance_characterId_fkey"
        FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'CharacterReferenceAsset_characterId_fkey'
    ) THEN
        ALTER TABLE "CharacterReferenceAsset"
        ADD CONSTRAINT "CharacterReferenceAsset_characterId_fkey"
        FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'CharacterFaceEmbedding_characterId_fkey'
    ) THEN
        ALTER TABLE "CharacterFaceEmbedding"
        ADD CONSTRAINT "CharacterFaceEmbedding_characterId_fkey"
        FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
