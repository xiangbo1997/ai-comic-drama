/**
 * 任务队列服务
 * 支持 BullMQ（Redis）和内存队列（开发/Serverless）
 */

import { EventEmitter } from "events";

import { createLogger } from "@/lib/logger";
const log = createLogger("services:queue");

// 任务类型
export type JobType =
  | "image:generate"
  | "video:generate"
  | "audio:generate"
  | "export:video"
  | "content:check";

// 任务状态
export type JobStatus =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed";

// 任务数据接口
export interface JobData {
  type: JobType;
  payload: Record<string, unknown>;
  userId: string;
  projectId?: string;
  sceneId?: string;
  priority?: number;
  attempts?: number;
  maxAttempts?: number;
}

// 任务结果
export interface JobResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// 任务信息
export interface JobInfo {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  data: JobData;
  result?: JobResult;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedReason?: string;
  attemptsMade: number;
}

// 队列配置
export interface QueueConfig {
  concurrency?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

// 任务处理器
export type JobProcessor = (job: JobInfo) => Promise<JobResult>;

/**
 * 抽象队列接口
 */
interface IQueue {
  add(data: JobData): Promise<string>;
  getJob(jobId: string): Promise<JobInfo | null>;
  getJobs(status?: JobStatus): Promise<JobInfo[]>;
  process(processor: JobProcessor): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 内存队列实现（开发环境/Serverless）
 */
class InMemoryQueue implements IQueue {
  private jobs: Map<string, JobInfo> = new Map();
  private queue: string[] = [];
  private processor: JobProcessor | null = null;
  private processing = false;
  private paused = false;
  private config: QueueConfig;
  private emitter = new EventEmitter();

  constructor(config: QueueConfig = {}) {
    this.config = {
      concurrency: config.concurrency || 2,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000,
      timeout: config.timeout || 300000,
    };
  }

  async add(data: JobData): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const job: JobInfo = {
      id: jobId,
      type: data.type,
      status: "waiting",
      progress: 0,
      data,
      createdAt: new Date(),
      attemptsMade: 0,
    };

    this.jobs.set(jobId, job);
    this.queue.push(jobId);

    // 触发处理
    this.processNext();

    return jobId;
  }

  async getJob(jobId: string): Promise<JobInfo | null> {
    return this.jobs.get(jobId) || null;
  }

  async getJobs(status?: JobStatus): Promise<JobInfo[]> {
    const jobs = Array.from(this.jobs.values());
    if (status) {
      return jobs.filter((j) => j.status === status);
    }
    return jobs;
  }

  process(processor: JobProcessor): void {
    this.processor = processor;
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.paused || this.processing || !this.processor) return;
    if (this.queue.length === 0) return;

    this.processing = true;

    // 获取并发数量的任务
    const concurrent = Math.min(this.config.concurrency!, this.queue.length);
    const jobIds = this.queue.splice(0, concurrent);

    await Promise.all(
      jobIds.map(async (jobId) => {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = "active";
        job.startedAt = new Date();
        job.attemptsMade++;

        try {
          // 设置超时
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("Job timeout")),
              this.config.timeout
            );
          });

          const result = await Promise.race([
            this.processor!(job),
            timeoutPromise,
          ]);

          job.status = "completed";
          job.completedAt = new Date();
          job.progress = 100;
          job.result = result;

          this.emitter.emit("completed", job);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          // 检查是否需要重试
          if (job.attemptsMade < (this.config.maxRetries || 3)) {
            job.status = "delayed";
            job.failedReason = `Attempt ${job.attemptsMade} failed: ${errorMessage}`;

            // 延迟后重新加入队列
            setTimeout(() => {
              job.status = "waiting";
              this.queue.push(jobId);
              this.processNext();
            }, this.config.retryDelay);
          } else {
            job.status = "failed";
            job.completedAt = new Date();
            job.failedReason = errorMessage;
            job.result = { success: false, error: errorMessage };

            this.emitter.emit("failed", job, new Error(errorMessage));
          }
        }
      })
    );

    this.processing = false;

    // 继续处理下一批
    if (this.queue.length > 0) {
      setImmediate(() => this.processNext());
    }
  }

  async pause(): Promise<void> {
    this.paused = true;
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.processNext();
  }

  async close(): Promise<void> {
    this.paused = true;
    this.jobs.clear();
    this.queue = [];
  }

  on(
    event: "completed" | "failed",
    listener: (...args: unknown[]) => void
  ): void {
    this.emitter.on(event, listener);
  }

  // 更新任务进度
  updateProgress(jobId: string, progress: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = Math.min(100, Math.max(0, progress));
    }
  }
}

/**
 * BullMQ 队列实现（生产环境）
 */
class BullMQQueue implements IQueue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BullMQ 动态导入，无法静态声明类型
  private queue: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private worker: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queueEvents: any;
  private config: QueueConfig;
  private initialized = false;

  constructor(
    private queueName: string,
    config: QueueConfig = {}
  ) {
    this.config = {
      concurrency: config.concurrency || 5,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000,
      timeout: config.timeout || 300000,
    };
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL not configured");
    }

    // 动态导入 BullMQ（避免在没有 Redis 时报错）
    const { Queue, QueueEvents } = await import("bullmq");

    const connection = { url: redisUrl };

    this.queue = new Queue(this.queueName, { connection });
    this.queueEvents = new QueueEvents(this.queueName, { connection });

    this.initialized = true;
  }

  async add(data: JobData): Promise<string> {
    await this.initialize();

    // Stage 2.1：BullMQ job options 强化
    // - removeOnComplete: 完成后保留最近 1000 条（便于排查），其余清理
    // - removeOnFail: 失败保留最近 5000 条（调试价值更高）
    // - attempts/backoff 按 config 动态
    const job = await this.queue.add(data.type, data, {
      priority: data.priority || 0,
      attempts: data.maxAttempts || this.config.maxRetries,
      backoff: {
        type: "exponential",
        delay: this.config.retryDelay,
      },
      timeout: this.config.timeout,
      removeOnComplete: { count: 1000, age: 7 * 24 * 3600 }, // 7 天或 1000 条
      removeOnFail: { count: 5000, age: 30 * 24 * 3600 }, // 30 天或 5000 条
    });

    return job.id;
  }

  async getJob(jobId: string): Promise<JobInfo | null> {
    await this.initialize();

    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();

    return {
      id: job.id,
      type: job.name as JobType,
      status: this.mapState(state),
      progress: job.progress || 0,
      data: job.data,
      result: job.returnvalue,
      createdAt: new Date(job.timestamp),
      startedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
    };
  }

  async getJobs(status?: JobStatus): Promise<JobInfo[]> {
    await this.initialize();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let jobs: any[];

    if (status) {
      const states = this.mapStatusToStates(status);
      jobs = await this.queue.getJobs(states);
    } else {
      jobs = await this.queue.getJobs();
    }

    return Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jobs.map(async (job: any) => {
        const state = await job.getState();
        return {
          id: job.id,
          type: job.name as JobType,
          status: this.mapState(state),
          progress: job.progress || 0,
          data: job.data,
          result: job.returnvalue,
          createdAt: new Date(job.timestamp),
          startedAt: job.processedOn ? new Date(job.processedOn) : undefined,
          completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
        };
      })
    );
  }

  process(processor: JobProcessor): void {
    this.initialize().then(async () => {
      const { Worker } = await import("bullmq");
      const redisUrl = process.env.REDIS_URL;

      this.worker = new Worker(
        this.queueName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (job: any) => {
          const jobInfo: JobInfo = {
            id: job.id,
            type: job.name as JobType,
            status: "active",
            progress: 0,
            data: job.data,
            createdAt: new Date(job.timestamp),
            startedAt: new Date(),
            attemptsMade: job.attemptsMade,
          };

          // 更新进度的辅助函数
          const updateProgress = async (progress: number) => {
            await job.updateProgress(progress);
          };

          const result = await processor({
            ...jobInfo,
            // @ts-expect-error - 添加进度更新方法
            updateProgress,
          });

          return result;
        },
        {
          connection: { url: redisUrl },
          concurrency: this.config.concurrency,
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.worker.on("completed", (job: any, result: any) => {
        log.info(`Job ${job.id} completed`, result);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.worker.on("failed", (job: any, err: Error) => {
        log.error(`Job ${job?.id} failed:`, err.message);
      });
    });
  }

  async pause(): Promise<void> {
    await this.initialize();
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    await this.initialize();
    await this.queue.resume();
  }

  async close(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queueEvents) await this.queueEvents.close();
    if (this.queue) await this.queue.close();
  }

  private mapState(state: string): JobStatus {
    switch (state) {
      case "waiting":
      case "prioritized":
        return "waiting";
      case "active":
        return "active";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "delayed":
        return "delayed";
      default:
        return "waiting";
    }
  }

  private mapStatusToStates(status: JobStatus): string[] {
    switch (status) {
      case "waiting":
        return ["waiting", "prioritized"];
      case "active":
        return ["active"];
      case "completed":
        return ["completed"];
      case "failed":
        return ["failed"];
      case "delayed":
        return ["delayed"];
      default:
        return [];
    }
  }
}

/**
 * 队列管理器
 */
class QueueManager {
  private queues: Map<string, IQueue> = new Map();
  private useRedis: boolean;

  constructor() {
    this.useRedis = !!process.env.REDIS_URL;
  }

  getQueue(name: string, config?: QueueConfig): IQueue {
    if (!this.queues.has(name)) {
      const queue = this.useRedis
        ? new BullMQQueue(name, config)
        : new InMemoryQueue(config);
      this.queues.set(name, queue);
    }
    return this.queues.get(name)!;
  }

  async closeAll(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }

  isUsingRedis(): boolean {
    return this.useRedis;
  }
}

// 全局队列管理器
export const queueManager = new QueueManager();

// Stage 2.1：预定义的队列（分桶版）
// 图像/视频/音频按 provider 带宽与 latency 不同，拆为独立队列，各自 concurrency：
// - image：最高并发（单张 10-30s，Provider 通常支持 5+ 并发）
// - video：低并发（2-5min，Provider 常见 1-2 并发）
// - audio：中等并发（5-15s，Provider 一般支持 3-5 并发）
// 导出保持 1 并发（FFmpeg CPU 密集）。
//
// 保留 generationQueue 作为兼容别名，指向 imageQueue，避免破坏旧调用路径。
export const imageQueue = queueManager.getQueue("image", {
  concurrency: 5,
  maxRetries: 2,
  timeout: 600000, // 10 分钟
});

export const videoQueue = queueManager.getQueue("video", {
  concurrency: 2,
  maxRetries: 1,
  timeout: 900000, // 15 分钟
});

export const audioQueue = queueManager.getQueue("audio", {
  concurrency: 3,
  maxRetries: 2,
  timeout: 300000, // 5 分钟
});

/** @deprecated 保留以兼容旧调用；新代码应使用 imageQueue/videoQueue/audioQueue */
export const generationQueue = imageQueue;

export const exportQueue = queueManager.getQueue("export", {
  concurrency: 1,
  maxRetries: 1,
  timeout: 1800000, // 30 分钟
});

/**
 * 添加图像生成任务
 */
export async function addImageGenerationJob(params: {
  userId: string;
  projectId?: string;
  sceneId?: string;
  prompt: string;
  referenceImage?: string;
  aspectRatio?: string;
  style?: string;
}): Promise<string> {
  return imageQueue.add({
    type: "image:generate",
    userId: params.userId,
    projectId: params.projectId,
    sceneId: params.sceneId,
    payload: {
      prompt: params.prompt,
      referenceImage: params.referenceImage,
      aspectRatio: params.aspectRatio,
      style: params.style,
    },
    priority: 1,
  });
}

/**
 * 添加视频生成任务
 */
export async function addVideoGenerationJob(params: {
  userId: string;
  projectId?: string;
  sceneId?: string;
  imageUrl: string;
  duration?: number;
}): Promise<string> {
  return videoQueue.add({
    type: "video:generate",
    userId: params.userId,
    projectId: params.projectId,
    sceneId: params.sceneId,
    payload: {
      imageUrl: params.imageUrl,
      duration: params.duration || 5,
    },
    priority: 2,
  });
}

/**
 * 添加音频生成任务
 */
export async function addAudioGenerationJob(params: {
  userId: string;
  projectId?: string;
  sceneId?: string;
  text: string;
  voiceId?: string;
  speed?: number;
}): Promise<string> {
  return audioQueue.add({
    type: "audio:generate",
    userId: params.userId,
    projectId: params.projectId,
    sceneId: params.sceneId,
    payload: {
      text: params.text,
      voiceId: params.voiceId,
      speed: params.speed || 1,
    },
    priority: 3,
  });
}

/**
 * 添加导出任务
 */
export async function addExportJob(params: {
  userId: string;
  projectId: string;
  format: string;
  quality: string;
  includeSubtitles: boolean;
  includeAudio: boolean;
}): Promise<string> {
  return exportQueue.add({
    type: "export:video",
    userId: params.userId,
    projectId: params.projectId,
    payload: params,
    priority: 0,
  });
}

/** 支持的队列名称（Stage 2.1 分桶后） */
export type QueueName = "image" | "video" | "audio" | "export" | "generation";

function resolveQueueByName(name: QueueName): IQueue {
  switch (name) {
    case "image":
    case "generation": // 兼容旧名
      return imageQueue;
    case "video":
      return videoQueue;
    case "audio":
      return audioQueue;
    case "export":
      return exportQueue;
  }
}

/**
 * 获取任务状态
 */
export async function getJobStatus(
  queueName: QueueName,
  jobId: string
): Promise<JobInfo | null> {
  return resolveQueueByName(queueName).getJob(jobId);
}

/**
 * 获取用户的任务列表
 */
export async function getUserJobs(
  userId: string,
  queueName?: QueueName
): Promise<JobInfo[]> {
  const queues: IQueue[] = queueName
    ? [resolveQueueByName(queueName)]
    : [imageQueue, videoQueue, audioQueue, exportQueue];

  const allJobs: JobInfo[] = [];

  for (const queue of queues) {
    const jobs = await queue.getJobs();
    allJobs.push(...jobs.filter((j) => j.data.userId === userId));
  }

  return allJobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
