/**
 * 必填环境变量校验单测（lib/env.ts）
 */

import { describe, it, expect } from "vitest";
import { validateEnv } from "@/lib/env";

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
