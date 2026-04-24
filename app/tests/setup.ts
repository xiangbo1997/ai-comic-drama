/**
 * Vitest 全局 setup（Stage 3.7）
 *
 * 作用：
 * - 确保测试环境中"外部依赖"默认被禁用/mock：
 *   - `REDIS_URL` 空 → lib/redis.ts 降级到 null，所有基于 Redis 的模块走 memory fallback
 *   - `LANGFUSE_*` 空 → observability 禁用
 * - 提供一个有效的 ENCRYPTION_KEY 避免 lib/encryption.ts 初始化抛错（即使当前测试不覆盖）
 *
 * 每个 test file 如需额外覆盖 env，在测试里用 `vi.stubEnv()`。
 */

// 清空可能从 shell 带入的外部依赖
delete process.env.REDIS_URL;
delete process.env.LANGFUSE_PUBLIC_KEY;
delete process.env.LANGFUSE_SECRET_KEY;

// 占位但格式有效的 env
// NODE_ENV 在 @types/node 里是 readonly；vitest 默认会设为 "test"，这里不再覆盖。
process.env.ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";
process.env.OPENAI_API_KEY = "test-key";
process.env.LOG_LEVEL = "error"; // 压制测试时的 info/warn 日志噪音
