/**
 * 运维总览端点
 *
 * GET /api/admin/ops/status
 *
 * 一次拿齐运维页需要的全部只读状态：健康检查、存储/Redis 配置、磁盘余量、
 * 僵尸任务、备份文件列表。
 *
 * 健康检查**直接跑 SELECT 1** 而不是内部 fetch `/api/health`：进程给自己发
 * HTTP 请求要么走真实网络栈（受端口/反代/防火墙影响，容器里常直接超时），
 * 要么依赖 Next 的内部路由细节，两者都比一行 queryRaw 脆弱得多。代价是
 * 这段判活逻辑与 /api/health 各写一份，但它只有三行，重复成本远低于耦合。
 *
 * 目录遍历（uploads 体积）有**时间与深度双上限**：public/uploads 在长期运行
 * 的机器上可能有数万文件，无上限的递归会让这个端点变成慢查询，30 秒轮询一次
 * 就是持续的磁盘压力。超时即返回已累计的部分并置 truncated 标记。
 */

import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { ZOMBIE_LIST_LIMIT, zombieCutoff } from "@/lib/admin-dashboard";
import {
  DEFAULT_LOCAL_STORAGE_DIR,
  getRedisEnv,
  getRuntimeEnv,
  getStorageEnv,
} from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isR2Configured } from "@/services/storage";

const log = createLogger("api:admin:ops:status");

export const dynamic = "force-dynamic";

/** 备份目录（deploy/backup.sh 的落地路径，服务器上以 root 运行故可读） */
const BACKUP_DIR = "/backup";
/** 备份列表上限：只展示最近的若干份，历史清理由运维脚本负责 */
const BACKUP_LIST_LIMIT = 30;
/** uploads 目录遍历的墙钟预算（毫秒） */
const WALK_BUDGET_MS = 2000;
/** uploads 目录遍历的最大深度：正常布局只有 type/日期 两层，5 层足够兜底 */
const WALK_MAX_DEPTH = 5;

/** 本地上传目录的体积统计结果 */
interface UploadsUsage {
  bytes: number;
  files: number;
  /** 是否因超时/超深度提前停止（此时 bytes 是下界而非真实值） */
  truncated: boolean;
}

/**
 * 递归累加目录体积，受时间预算与深度限制。
 *
 * 目录不存在返回 null（本地开发常态：从没上传过文件就没有这个目录），
 * 由调用方翻译成「未启用/无数据」而不是错误。
 */
async function measureDirectory(dir: string): Promise<UploadsUsage | null> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const deadline = Date.now() + WALK_BUDGET_MS;
  let bytes = 0;
  let files = 0;
  let truncated = false;

  // 显式栈而非递归调用：目录层级异常深时递归会爆栈，且这样更容易在每轮
  // 循环顶部统一检查时间预算
  const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];

  while (stack.length > 0) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    const current = stack.pop();
    if (!current) break;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch (error) {
      // 单个子目录不可读（权限/竞态删除）不该让整体统计失败
      log.warn("读取目录失败，跳过", {
        dir: current.dir,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth + 1 > WALK_MAX_DEPTH) {
          truncated = true;
          continue;
        }
        stack.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      // 只统计常规文件；符号链接不跟随，避免链环导致无限遍历
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(full);
        bytes += stat.size;
        files += 1;
      } catch {
        // 遍历期间被删除，忽略
      }
    }
  }

  return { bytes, files, truncated };
}

/** 一份备份文件的元信息 */
interface BackupFile {
  name: string;
  size: number;
  mtime: string;
}

/**
 * 列出备份目录内容。
 *
 * 目录不存在（本地开发）返回 null，页面据此显示「本机无备份目录」而不是报错。
 */
async function listBackups(): Promise<BackupFile[] | null> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const files: BackupFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.stat(path.join(BACKUP_DIR, entry.name));
      files.push({
        name: entry.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch {
      // 竞态删除，忽略
    }
  }

  return files
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, BACKUP_LIST_LIMIT);
}

/** 磁盘容量（字节）；statfs 不可用时返回 null */
async function readDiskUsage(
  target: string
): Promise<{ free: number; total: number } | null> {
  // fs.promises.statfs 是 Node 18.15+ 的能力；线上是 Node 22，但类型与运行时
  // 都做一次存在性判断，避免降级环境直接抛错拖垮整个端点
  const statfs = (
    fs as unknown as {
      statfs?: (
        p: string
      ) => Promise<{ bsize: number; blocks: number; bavail: number }>;
    }
  ).statfs;
  if (typeof statfs !== "function") return null;

  try {
    const stats = await statfs(target);
    return {
      // bavail 是「非特权用户可用」，比 bfree 更贴近真实可写空间
      free: stats.bsize * stats.bavail,
      total: stats.bsize * stats.blocks,
    };
  } catch (error) {
    log.warn("读取磁盘容量失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  const cutoff = zombieCutoff();
  const uploadsDir = path.resolve(
    process.cwd(),
    getStorageEnv().LOCAL_STORAGE_DIR || DEFAULT_LOCAL_STORAGE_DIR
  );

  try {
    const [dbOk, zombieTasks, zombieWorkflows, uploads, backups, disk] =
      await Promise.all([
        prisma.$queryRaw`SELECT 1`
          .then(() => true)
          .catch((error: unknown) => {
            log.error("健康检查失败:", error);
            return false;
          }),
        prisma.generationTask.findMany({
          where: { status: "PROCESSING", updatedAt: { lt: cutoff } },
          orderBy: { updatedAt: "asc" },
          take: ZOMBIE_LIST_LIMIT,
          select: {
            id: true,
            type: true,
            sceneId: true,
            projectId: true,
            updatedAt: true,
          },
        }),
        prisma.workflowRun.findMany({
          where: { status: "RUNNING", updatedAt: { lt: cutoff } },
          orderBy: { updatedAt: "asc" },
          take: ZOMBIE_LIST_LIMIT,
          select: {
            id: true,
            projectId: true,
            currentStep: true,
            updatedAt: true,
          },
        }),
        measureDirectory(uploadsDir),
        listBackups(),
        readDiskUsage(process.cwd()),
      ]);

    return NextResponse.json({
      health: {
        ok: dbOk,
        uptime: process.uptime(),
        commit: getRuntimeEnv().commit,
      },
      storage: {
        r2Configured: isR2Configured(),
        localUploadsBytes: uploads?.bytes ?? null,
        localUploadsFiles: uploads?.files ?? null,
        localUploadsTruncated: uploads?.truncated ?? false,
      },
      redisConfigured: Boolean(getRedisEnv().REDIS_URL),
      zombies: {
        thresholdMinutes: 15,
        tasks: zombieTasks,
        workflows: zombieWorkflows,
      },
      backups: { dir: BACKUP_DIR, files: backups },
      disk,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    log.error("加载运维状态失败:", error);
    return NextResponse.json({ error: "加载运维状态失败" }, { status: 500 });
  }
}
