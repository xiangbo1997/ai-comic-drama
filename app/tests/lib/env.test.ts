/**
 * 环境变量单测（lib/env.ts）
 * - validateEnv：必填三项的启动校验
 * - getXxxEnv：可选能力组的解析、默认值、非法值降级与记忆化
 */

import { existsSync } from "fs";
import path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_GENERATION_MAX_CONCURRENCY,
  DEFAULT_PG_POOL_MAX,
  getAdminEnv,
  getContentSafetyEnv,
  getLimitsEnv,
  getObservabilityEnv,
  getPaymentEnv,
  getRedisEnv,
  getRuntimeEnv,
  getStorageEnv,
  resetEnvCache,
  validateEnv,
} from "@/lib/env";

const VALID = {
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/db",
  NEXTAUTH_SECRET: "a-secret-long-enough-1234",
  ENCRYPTION_KEY: "0".repeat(64),
};

describe("validateEnv", () => {
  it("三项齐全且格式正确时通过", () => {
    expect(validateEnv(VALID)).toEqual({ success: true, errors: [] });
  });

  it("允许 postgres:// 前缀", () => {
    const r = validateEnv({ ...VALID, DATABASE_URL: "postgres://a@h:5432/d" });
    expect(r.success).toBe(true);
  });

  it("拒绝非 postgres 连接串", () => {
    const r = validateEnv({ ...VALID, DATABASE_URL: "mysql://a@h:3306/d" });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toContain("DATABASE_URL");
  });

  it("NEXTAUTH_SECRET 短于 16 字符时报错", () => {
    const r = validateEnv({ ...VALID, NEXTAUTH_SECRET: "short" });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toContain("NEXTAUTH_SECRET");
  });

  it("ENCRYPTION_KEY 非 64 位十六进制时报错", () => {
    for (const bad of ["0".repeat(63), "z".repeat(64), "0".repeat(65)]) {
      const r = validateEnv({ ...VALID, ENCRYPTION_KEY: bad });
      expect(r.success).toBe(false);
      expect(r.errors[0]).toContain("ENCRYPTION_KEY");
    }
  });

  it("多项缺失时逐条报出，每个变量只报一条", () => {
    const r = validateEnv({});
    expect(r.success).toBe(false);
    expect(r.errors).toHaveLength(3);
    const keys = r.errors.map((e) => e.split(":")[0]).sort();
    expect(keys).toEqual(["DATABASE_URL", "ENCRYPTION_KEY", "NEXTAUTH_SECRET"]);
  });
});

describe("可选能力组 accessor", () => {
  // 每个用例都从干净缓存开始：accessor 记忆化，不清会串味
  beforeEach(() => {
    resetEnvCache();
  });
  afterEach(() => {
    resetEnvCache();
    vi.restoreAllMocks();
  });

  describe("空串归一", () => {
    it('空串与未设置等价（保持原 `process.env.X || ""` 的真值语义）', () => {
      const env = getStorageEnv({ R2_ENDPOINT: "", R2_ACCESS_KEY_ID: "   " });
      expect(env.R2_ENDPOINT).toBeUndefined();
      expect(env.R2_ACCESS_KEY_ID).toBeUndefined();
    });

    it("非空值原样返回", () => {
      const env = getStorageEnv({ R2_ENDPOINT: "https://r2.example.com" });
      expect(env.R2_ENDPOINT).toBe("https://r2.example.com");
    });
  });

  describe("数值组 limits", () => {
    it("未设置时返回 undefined，由调用方套默认常量", () => {
      const env = getLimitsEnv({});
      expect(env.GENERATION_MAX_CONCURRENCY).toBeUndefined();
      expect(env.PG_POOL_MAX).toBeUndefined();
      // 调用方的兜底常量与文档/`.env.example` 一致
      expect(DEFAULT_GENERATION_MAX_CONCURRENCY).toBe(8);
      expect(DEFAULT_PG_POOL_MAX).toBe(20);
    });

    it("数字字符串被强制转成 number", () => {
      const env = getLimitsEnv({
        GENERATION_MAX_CONCURRENCY: "16",
        PG_POOL_MAX: "40",
      });
      expect(env.GENERATION_MAX_CONCURRENCY).toBe(16);
      expect(env.PG_POOL_MAX).toBe(40);
    });

    it("非法值 → warn + 整组降级为「未配置」，不抛异常", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const env = getLimitsEnv({ GENERATION_MAX_CONCURRENCY: "abc" });
      expect(env.GENERATION_MAX_CONCURRENCY).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0][0])).toContain("limits");
    });

    it("零与负数按非法处理（并发上限必须为正）", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(getLimitsEnv({ PG_POOL_MAX: "0" }).PG_POOL_MAX).toBeUndefined();
      resetEnvCache();
      expect(getLimitsEnv({ PG_POOL_MAX: "-5" }).PG_POOL_MAX).toBeUndefined();
    });
  });

  describe("记忆化", () => {
    it("同一组只解析一次，后续调用忽略新的 source", () => {
      const first = getRedisEnv({ REDIS_URL: "redis://a:6379" });
      const second = getRedisEnv({ REDIS_URL: "redis://b:6379" });
      expect(first.REDIS_URL).toBe("redis://a:6379");
      // 命中缓存：env 在进程生命周期内不变，故返回同一对象
      expect(second).toBe(first);
    });

    it("resetEnvCache() 后重新解析", () => {
      expect(getRedisEnv({ REDIS_URL: "redis://a:6379" }).REDIS_URL).toBe(
        "redis://a:6379"
      );
      resetEnvCache();
      expect(getRedisEnv({ REDIS_URL: "redis://b:6379" }).REDIS_URL).toBe(
        "redis://b:6379"
      );
    });

    it("非法值只 warn 一次（结果同样被缓存）", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      getLimitsEnv({ PG_POOL_MAX: "nope" });
      getLimitsEnv({ PG_POOL_MAX: "nope" });
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe("各组变量覆盖", () => {
    it("payment 覆盖微信/支付宝/Stripe", () => {
      const env = getPaymentEnv({
        WECHAT_APP_ID: "wx",
        WECHAT_MCH_ID: "mch",
        ALIPAY_APP_ID: "ali",
        STRIPE_SECRET_KEY: "sk_test",
      });
      expect(env.WECHAT_APP_ID).toBe("wx");
      expect(env.WECHAT_MCH_ID).toBe("mch");
      expect(env.ALIPAY_APP_ID).toBe("ali");
      expect(env.STRIPE_SECRET_KEY).toBe("sk_test");
      expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    });

    it("contentSafety 覆盖阿里云/腾讯云", () => {
      const env = getContentSafetyEnv({
        ALIYUN_ACCESS_KEY_ID: "ak",
        TENCENT_SECRET_ID: "sid",
      });
      expect(env.ALIYUN_ACCESS_KEY_ID).toBe("ak");
      expect(env.TENCENT_SECRET_ID).toBe("sid");
      expect(env.ALIYUN_CONTENT_SAFETY_ENDPOINT).toBeUndefined();
    });

    it("admin 覆盖白名单与 cron 密钥", () => {
      const env = getAdminEnv({ ADMIN_EMAILS: "a@b.com", CRON_SECRET: "s" });
      expect(env.ADMIN_EMAILS).toBe("a@b.com");
      expect(env.CRON_SECRET).toBe("s");
    });

    it("observability 的 FLUSH_AT 转成 number", () => {
      const env = getObservabilityEnv({
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
        LANGFUSE_FLUSH_AT: "20",
      });
      expect(env.LANGFUSE_FLUSH_AT).toBe(20);
      expect(env.LANGFUSE_BASE_URL).toBeUndefined();
    });
  });

  describe("runtime 组", () => {
    it("GIT_COMMIT 优先于文件兜底", () => {
      const env = getRuntimeEnv({ GIT_COMMIT: "abc1234" });
      expect(env.commit).toBe("abc1234");
    });

    it("isProduction 只认 NODE_ENV=production", () => {
      expect(getRuntimeEnv({ NODE_ENV: "production" }).isProduction).toBe(true);
      resetEnvCache();
      expect(getRuntimeEnv({ NODE_ENV: "development" }).isProduction).toBe(
        false
      );
      resetEnvCache();
      expect(getRuntimeEnv({}).isProduction).toBe(false);
    });

    it("GIT_COMMIT 缺失时回落到文件；文件也没有则为 null", () => {
      // 本地跑过 deploy.sh 时 app/.git-commit 可能真实存在，故按文件是否存在
      // 分支断言，避免用例依赖开发机状态而 flaky
      const hasFile = [
        path.join(process.cwd(), "app/.git-commit"),
        path.join(process.cwd(), ".git-commit"),
      ].some((f) => existsSync(f));

      const { commit } = getRuntimeEnv({});
      if (hasFile) {
        expect(typeof commit).toBe("string");
        expect(commit).not.toBe("");
      } else {
        expect(commit).toBeNull();
      }
    });
  });
});
