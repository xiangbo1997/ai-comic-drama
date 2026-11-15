-- 仅新增助手表，不改动现有作品/故事圣经；部署时由既有迁移流程执行。
CREATE TABLE "AssistantThread" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seriesId" TEXT,
  "projectId" TEXT,
  "memoryContent" TEXT NOT NULL DEFAULT '',
  "memoryVersion" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantThread_scope_check" CHECK (
    ("seriesId" IS NOT NULL AND "projectId" IS NULL AND "scopeKey" = 'series:' || "seriesId") OR
    ("projectId" IS NOT NULL AND "seriesId" IS NULL AND "scopeKey" = 'project:' || "projectId")
  ),
  CONSTRAINT "AssistantThread_memory_check" CHECK (length("memoryContent") <= 12000 AND "memoryVersion" >= 0)
);
CREATE TABLE "AssistantRequest" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantRequest_status_check" CHECK ("status" IN ('PROCESSING', 'COMPLETED', 'FAILED'))
);
CREATE TABLE "AssistantMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantMessage_role_check" CHECK ("role" IN ('user', 'assistant'))
);
CREATE UNIQUE INDEX "AssistantThread_scopeKey_key" ON "AssistantThread"("scopeKey");
CREATE UNIQUE INDEX "AssistantThread_seriesId_key" ON "AssistantThread"("seriesId");
CREATE UNIQUE INDEX "AssistantThread_projectId_key" ON "AssistantThread"("projectId");
CREATE INDEX "AssistantThread_userId_idx" ON "AssistantThread"("userId");
CREATE UNIQUE INDEX "AssistantRequest_threadId_requestId_key" ON "AssistantRequest"("threadId", "requestId");
CREATE INDEX "AssistantMessage_threadId_createdAt_id_idx" ON "AssistantMessage"("threadId", "createdAt", "id");
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantRequest" ADD CONSTRAINT "AssistantRequest_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AssistantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
