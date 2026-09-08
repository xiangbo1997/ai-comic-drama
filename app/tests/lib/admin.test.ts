/**
 * 后台权限判定单测
 *
 * 覆盖 resolveAdmin 的四条关键路径（这是整个后台唯一的鉴权入口）：
 *  - 已是 ADMIN / SUPER_ADMIN → 放行
 *  - 普通用户 → 拒绝，且**不得**因为在 env 白名单外就被提升
 *  - env 白名单里的普通用户 → 提升为 SUPER_ADMIN 并落审计日志（引导通道）
 *  - BANNED → 一律拒绝，即便角色是超管、即便在 env 白名单里
 *
 * prisma 与 auth 都走手搓 mock：lib/admin 只用到 user.findUnique / user.update，
 * 且 auth() 在本测试里不参与（只测 resolveAdmin，不测 requireAdmin 的 session 获取）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const auditCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
    adminAuditLog: {
      create: (...args: unknown[]) => auditCreate(...args),
    },
  },
}));

// lib/admin 顶层 import 了 lib/auth（为 requireAdmin 用），而 lib/auth 会拉起
// NextAuth + PrismaAdapter，在 node 测试环境里既慢又有副作用。本文件只测
// resolveAdmin / requestIp，故把 auth 桩掉。
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { resolveAdmin } from "@/lib/admin";
import { requestIp } from "@/lib/admin-audit";
import { resetEnvCache } from "@/lib/env";

/** 构造一个只带 id 的最小 session（resolveAdmin 只读 user.id） */
function sessionOf(userId: string): Session {
  return {
    user: {
      id: userId,
      role: "USER",
      status: "ACTIVE",
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  } as Session;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEnvCache();
  delete process.env.ADMIN_EMAILS;
});

describe("resolveAdmin — 基础放行与拒绝", () => {
  it("无 session 返回 null，且不查库", async () => {
    expect(await resolveAdmin(null)).toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("session 里没有 user.id 返回 null", async () => {
    const broken = { user: {}, expires: "" } as unknown as Session;
    expect(await resolveAdmin(broken)).toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("用户在库里不存在返回 null", async () => {
    userFindUnique.mockResolvedValue(null);
    expect(await resolveAdmin(sessionOf("u1"))).toBeNull();
  });

  it("ADMIN 直接放行", async () => {
    userFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@x.com",
      role: "ADMIN",
      status: "ACTIVE",
    });

    expect(await resolveAdmin(sessionOf("u1"))).toEqual({
      id: "u1",
      email: "a@x.com",
      role: "ADMIN",
    });
    // 已是管理员不该触发任何写操作
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN 直接放行", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2",
      email: "s@x.com",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    });

    expect(await resolveAdmin(sessionOf("u2"))).toEqual({
      id: "u2",
      email: "s@x.com",
      role: "SUPER_ADMIN",
    });
  });

  it("普通用户且不在 env 白名单 → 拒绝，且绝不提权", async () => {
    userFindUnique.mockResolvedValue({
      id: "u3",
      email: "plain@x.com",
      role: "USER",
      status: "ACTIVE",
    });

    expect(await resolveAdmin(sessionOf("u3"))).toBeNull();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("查库异常时返回 null（失败关闭，不放行）", async () => {
    userFindUnique.mockRejectedValue(new Error("db down"));
    expect(await resolveAdmin(sessionOf("u1"))).toBeNull();
  });
});

describe("resolveAdmin — BANNED 一律拒绝", () => {
  it("被封禁的普通用户拒绝", async () => {
    userFindUnique.mockResolvedValue({
      id: "u4",
      email: "banned@x.com",
      role: "USER",
      status: "BANNED",
    });
    expect(await resolveAdmin(sessionOf("u4"))).toBeNull();
  });

  it("被封禁的超管也拒绝（封禁优先于角色）", async () => {
    userFindUnique.mockResolvedValue({
      id: "u5",
      email: "boss@x.com",
      role: "SUPER_ADMIN",
      status: "BANNED",
    });
    expect(await resolveAdmin(sessionOf("u5"))).toBeNull();
  });

  it("被封禁且在 env 白名单里，也不得被引导提升", async () => {
    process.env.ADMIN_EMAILS = "banned@x.com";
    userFindUnique.mockResolvedValue({
      id: "u6",
      email: "banned@x.com",
      role: "USER",
      status: "BANNED",
    });

    expect(await resolveAdmin(sessionOf("u6"))).toBeNull();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("resolveAdmin — env 引导提升", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "boot@x.com, other@x.com";
    resetEnvCache();
  });

  it("白名单里的普通用户被提升为 SUPER_ADMIN 并写审计日志", async () => {
    userFindUnique.mockResolvedValue({
      id: "u7",
      email: "boot@x.com",
      role: "USER",
      status: "ACTIVE",
    });
    userUpdate.mockResolvedValue({
      id: "u7",
      email: "boot@x.com",
      role: "SUPER_ADMIN",
    });

    const admin = await resolveAdmin(sessionOf("u7"));

    expect(admin).toEqual({
      id: "u7",
      email: "boot@x.com",
      role: "SUPER_ADMIN",
    });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u7" },
        data: { role: "SUPER_ADMIN" },
      })
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "bootstrap.promote",
          actorId: "u7",
          targetType: "user",
          targetId: "u7",
        }),
      })
    );
  });

  it("邮箱大小写不敏感", async () => {
    userFindUnique.mockResolvedValue({
      id: "u8",
      email: "BOOT@X.COM",
      role: "USER",
      status: "ACTIVE",
    });
    userUpdate.mockResolvedValue({
      id: "u8",
      email: "BOOT@X.COM",
      role: "SUPER_ADMIN",
    });

    const admin = await resolveAdmin(sessionOf("u8"));
    expect(admin?.role).toBe("SUPER_ADMIN");
  });

  it("不在白名单的邮箱不被提升", async () => {
    userFindUnique.mockResolvedValue({
      id: "u9",
      email: "nope@x.com",
      role: "USER",
      status: "ACTIVE",
    });

    expect(await resolveAdmin(sessionOf("u9"))).toBeNull();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("提升写库失败时返回 null（不假装成功）", async () => {
    userFindUnique.mockResolvedValue({
      id: "u10",
      email: "boot@x.com",
      role: "USER",
      status: "ACTIVE",
    });
    userUpdate.mockRejectedValue(new Error("db down"));

    expect(await resolveAdmin(sessionOf("u10"))).toBeNull();
  });
});

describe("requestIp — 代理头解析", () => {
  /** 构造只带 headers 的最小请求（requestIp 只读 headers） */
  const reqWith = (headers: Record<string, string>) =>
    ({
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
    }) as unknown as Parameters<typeof requestIp>[0];

  it("取 x-forwarded-for 的第一跳", () => {
    expect(
      requestIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" }))
    ).toBe("1.2.3.4");
  });

  it("单值的 x-forwarded-for 原样返回并去空白", () => {
    expect(requestIp(reqWith({ "x-forwarded-for": "  1.2.3.4  " }))).toBe(
      "1.2.3.4"
    );
  });

  it("没有 x-forwarded-for 时回落 x-real-ip", () => {
    expect(requestIp(reqWith({ "x-real-ip": "10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("x-forwarded-for 第一跳为空时回落 x-real-ip", () => {
    expect(
      requestIp(
        reqWith({ "x-forwarded-for": " , 5.6.7.8", "x-real-ip": "10.0.0.1" })
      )
    ).toBe("10.0.0.1");
  });

  it("两个头都没有时返回 undefined", () => {
    expect(requestIp(reqWith({}))).toBeUndefined();
  });

  it("x-real-ip 为空串时返回 undefined（而非空串）", () => {
    expect(requestIp(reqWith({ "x-real-ip": "   " }))).toBeUndefined();
  });
});
