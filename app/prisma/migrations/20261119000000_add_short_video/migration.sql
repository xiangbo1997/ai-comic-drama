-- CreateTable
CREATE TABLE "SvSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "originalUrl" TEXT,
    "canonicalUrl" TEXT,
    "canonicalKey" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT,
    "summary" TEXT NOT NULL,
    "authorDisplay" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "metrics" JSONB,
    "ingestionMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "connectorId" TEXT,
    "rightsNote" TEXT,
    "rawMetadata" JSONB,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SvSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemInstructions" TEXT NOT NULL,
    "characterPreset" JSONB NOT NULL DEFAULT '{}',
    "stylePreset" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultKey" TEXT,

    CONSTRAINT "SvTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvVideo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "templateId" TEXT,
    "projectId" TEXT,
    "currentScriptVersionId" TEXT,
    "currentArtifactId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scriptCounter" INTEGER NOT NULL DEFAULT 0,
    "artifactCounter" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SvVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvVideoSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "videoId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "SvVideoSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvScriptVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "videoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "modelRef" JSONB,

    CONSTRAINT "SvScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "videoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scriptVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "configFingerprint" TEXT NOT NULL,
    "priceFingerprint" TEXT NOT NULL,
    "maxCredits" INTEGER NOT NULL,
    "spentCredits" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SvRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvRunStep" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "operationKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "generationTaskId" TEXT,
    "externalTaskId" TEXT,
    "estimatedCredits" INTEGER NOT NULL,
    "actualCredits" INTEGER,
    "settledAt" TIMESTAMP(3),
    "input" JSONB NOT NULL,
    "output" JSONB,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SvRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvArtifact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "videoId" TEXT NOT NULL,
    "runId" TEXT,
    "operationKey" TEXT,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "metadata" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SvArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'MANUAL',
    "connectorId" TEXT,
    "credentialCiphertext" TEXT,
    "credentialIv" TEXT,
    "credentialExpiresAt" TIMESTAMP(3),
    "capabilitySnapshot" JSONB NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "SvAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvPublication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "videoId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "displayTimeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedHash" TEXT,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "submissionStartedAt" TIMESTAMP(3),
    "externalSubmissionId" TEXT,
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorSummary" TEXT,

    CONSTRAINT "SvPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvPublicationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publicationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "detail" JSONB NOT NULL,

    CONSTRAINT "SvPublicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvMetricSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publicationId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "windowLabel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "attributedFollowers" INTEGER,
    "completionRate" DOUBLE PRECISION,
    "avgWatchMs" INTEGER,

    CONSTRAINT "SvMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvDiscoveryJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "keywords" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "resultSourceIds" JSONB NOT NULL DEFAULT '[]',
    "errorCode" TEXT,
    "errorSummary" TEXT,

    CONSTRAINT "SvDiscoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvRequestReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseRef" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',

    CONSTRAINT "SvRequestReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SvWorker" (
    "id" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SvWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SvSource_userId_createdAt_id_idx" ON "SvSource"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvSource_userId_platform_canonicalKey_key" ON "SvSource"("userId", "platform", "canonicalKey");

-- CreateIndex
CREATE INDEX "SvTemplate_userId_createdAt_id_idx" ON "SvTemplate"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvTemplate_userId_defaultKey_key" ON "SvTemplate"("userId", "defaultKey");

-- CreateIndex
CREATE UNIQUE INDEX "SvVideo_projectId_key" ON "SvVideo"("projectId");

-- CreateIndex
CREATE INDEX "SvVideo_userId_createdAt_id_idx" ON "SvVideo"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SvVideoSource_userId_createdAt_id_idx" ON "SvVideoSource"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvVideoSource_videoId_sourceId_key" ON "SvVideoSource"("videoId", "sourceId");

-- CreateIndex
CREATE INDEX "SvScriptVersion_userId_createdAt_id_idx" ON "SvScriptVersion"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvScriptVersion_videoId_version_key" ON "SvScriptVersion"("videoId", "version");

-- CreateIndex
CREATE INDEX "SvRun_status_leaseUntil_idx" ON "SvRun"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "SvRun_userId_createdAt_id_idx" ON "SvRun"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvRun_userId_requestId_key" ON "SvRun"("userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SvRunStep_operationKey_key" ON "SvRunStep"("operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "SvRunStep_generationTaskId_key" ON "SvRunStep"("generationTaskId");

-- CreateIndex
CREATE INDEX "SvRunStep_userId_createdAt_id_idx" ON "SvRunStep"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvRunStep_runId_key_key" ON "SvRunStep"("runId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SvArtifact_operationKey_key" ON "SvArtifact"("operationKey");

-- CreateIndex
CREATE INDEX "SvArtifact_userId_createdAt_id_idx" ON "SvArtifact"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvArtifact_videoId_kind_version_key" ON "SvArtifact"("videoId", "kind", "version");

-- CreateIndex
CREATE INDEX "SvAccount_userId_createdAt_id_idx" ON "SvAccount"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvAccount_userId_platform_externalAccountId_key" ON "SvAccount"("userId", "platform", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SvPublication_operationKey_key" ON "SvPublication"("operationKey");

-- CreateIndex
CREATE INDEX "SvPublication_status_scheduledAt_idx" ON "SvPublication"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SvPublication_status_nextCheckAt_idx" ON "SvPublication"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "SvPublication_userId_createdAt_id_idx" ON "SvPublication"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvPublication_userId_requestId_key" ON "SvPublication"("userId", "requestId");

-- CreateIndex
CREATE INDEX "SvPublicationEvent_publicationId_createdAt_id_idx" ON "SvPublicationEvent"("publicationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SvPublicationEvent_userId_createdAt_id_idx" ON "SvPublicationEvent"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SvMetricSnapshot_publicationId_observedAt_idx" ON "SvMetricSnapshot"("publicationId", "observedAt");

-- CreateIndex
CREATE INDEX "SvMetricSnapshot_userId_createdAt_id_idx" ON "SvMetricSnapshot"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SvDiscoveryJob_status_leaseUntil_idx" ON "SvDiscoveryJob"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "SvDiscoveryJob_userId_createdAt_id_idx" ON "SvDiscoveryJob"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvDiscoveryJob_userId_requestId_key" ON "SvDiscoveryJob"("userId", "requestId");

-- CreateIndex
CREATE INDEX "SvRequestReceipt_userId_createdAt_id_idx" ON "SvRequestReceipt"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SvRequestReceipt_userId_scope_requestId_key" ON "SvRequestReceipt"("userId", "scope", "requestId");

-- AddForeignKey
ALTER TABLE "SvSource" ADD CONSTRAINT "SvSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvTemplate" ADD CONSTRAINT "SvTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvVideo" ADD CONSTRAINT "SvVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvVideo" ADD CONSTRAINT "SvVideo_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SvTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvVideo" ADD CONSTRAINT "SvVideo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvVideoSource" ADD CONSTRAINT "SvVideoSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvVideoSource" ADD CONSTRAINT "SvVideoSource_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "SvVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvVideoSource" ADD CONSTRAINT "SvVideoSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SvSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvScriptVersion" ADD CONSTRAINT "SvScriptVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvScriptVersion" ADD CONSTRAINT "SvScriptVersion_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "SvVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvRun" ADD CONSTRAINT "SvRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvRun" ADD CONSTRAINT "SvRun_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "SvVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvRun" ADD CONSTRAINT "SvRun_scriptVersionId_fkey" FOREIGN KEY ("scriptVersionId") REFERENCES "SvScriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvRunStep" ADD CONSTRAINT "SvRunStep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvRunStep" ADD CONSTRAINT "SvRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SvRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvArtifact" ADD CONSTRAINT "SvArtifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvArtifact" ADD CONSTRAINT "SvArtifact_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "SvVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvArtifact" ADD CONSTRAINT "SvArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SvRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvAccount" ADD CONSTRAINT "SvAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvPublication" ADD CONSTRAINT "SvPublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvPublication" ADD CONSTRAINT "SvPublication_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "SvVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvPublication" ADD CONSTRAINT "SvPublication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SvAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvPublication" ADD CONSTRAINT "SvPublication_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "SvArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvPublicationEvent" ADD CONSTRAINT "SvPublicationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvPublicationEvent" ADD CONSTRAINT "SvPublicationEvent_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "SvPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvMetricSnapshot" ADD CONSTRAINT "SvMetricSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvMetricSnapshot" ADD CONSTRAINT "SvMetricSnapshot_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "SvPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvDiscoveryJob" ADD CONSTRAINT "SvDiscoveryJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SvRequestReceipt" ADD CONSTRAINT "SvRequestReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 数据库兜底：一个作品仅可有一个活跃执行，停止后的未知子任务仍由服务层阻断。
CREATE UNIQUE INDEX "SvRun_one_active_video" ON "SvRun" ("videoId")
WHERE "status" IN ('QUEUED','RUNNING','PAUSED','NEEDS_RECONCILIATION','STOPPING');
ALTER TABLE "SvRun" ADD CONSTRAINT "SvRun_budget_nonnegative" CHECK ("maxCredits" >= 0 AND "spentCredits" >= 0 AND "reservedCredits" >= 0 AND "spentCredits" + "reservedCredits" <= "maxCredits");
ALTER TABLE "SvArtifact" ADD CONSTRAINT "SvArtifact_media_valid" CHECK ("bytes" > 0 AND ("durationMs" IS NULL OR "durationMs" > 0));
ALTER TABLE "SvVideo" ADD CONSTRAINT "SvVideo_current_script_fk" FOREIGN KEY ("currentScriptVersionId") REFERENCES "SvScriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SvVideo" ADD CONSTRAINT "SvVideo_current_artifact_fk" FOREIGN KEY ("currentArtifactId") REFERENCES "SvArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
