/**
 * 用户管理权限矩阵单测
 *
 * canActOn 是后台唯一一处「谁能对谁做什么」的判定，一旦放宽就是越权漏洞，
 * 故对 角色 × 目标角色 × 动作 的组合做穷举覆盖，而不是抽样验几条。
 */

import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";

import {
  canActOn,
  isSuperOnlyAction,
  parseUserSort,
  type AdminUserAction,
} from "@/lib/admin-users";

const ACTIONS: AdminUserAction[] = [
  "update",
  "role",
  "ban",
  "credits",
  "password",
];
const ROLES: UserRole[] = ["USER", "ADMIN", "SUPER_ADMIN"];

const actor = (role: UserRole, id = "actor-1") => ({ id, role });
const target = (role: UserRole, id = "target-1") => ({ id, role });

describe("canActOn — 自我保护", () => {
  it("任何角色都不能对自己改角色 / 封禁 / 重置密码 / 增减积分", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        if (action === "update") continue;
        const verdict = canActOn(
          actor(role, "same"),
          target(role, "same"),
          action
        );
        expect(verdict.allowed, `${role} 对自己 ${action}`).toBe(false);
        expect(verdict.reason).toContain("不能对自己");
      }
    }
  });

  it("允许修改自己的昵称", () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"] as UserRole[]) {
      expect(
        canActOn(actor(role, "same"), target(role, "same"), "update").allowed
      ).toBe(true);
    }
  });
});

describe("canActOn — 非管理员操作者", () => {
  it("USER 作为操作者一律被拒", () => {
    for (const targetRole of ROLES) {
      for (const action of ACTIONS) {
        const verdict = canActOn(actor("USER"), target(targetRole), action);
        expect(verdict.allowed, `USER 对 ${targetRole} ${action}`).toBe(false);
      }
    }
  });
});

describe("canActOn — 普通管理员（ADMIN）", () => {
  it("对 USER / ADMIN 可改昵称与增减积分", () => {
    for (const targetRole of ["USER", "ADMIN"] as UserRole[]) {
      expect(
        canActOn(actor("ADMIN"), target(targetRole), "update").allowed
      ).toBe(true);
      expect(
        canActOn(actor("ADMIN"), target(targetRole), "credits").allowed
      ).toBe(true);
    }
  });

  it("对 USER / ADMIN 不能改角色 / 封禁 / 重置密码", () => {
    for (const targetRole of ["USER", "ADMIN"] as UserRole[]) {
      for (const action of ["role", "ban", "password"] as AdminUserAction[]) {
        const verdict = canActOn(actor("ADMIN"), target(targetRole), action);
        expect(verdict.allowed, `ADMIN 对 ${targetRole} ${action}`).toBe(false);
        expect(verdict.reason).toBe("需要超级管理员权限");
      }
    }
  });

  it("对 SUPER_ADMIN 的任何动作都被拒（横向越权防线）", () => {
    for (const action of ACTIONS) {
      const verdict = canActOn(actor("ADMIN"), target("SUPER_ADMIN"), action);
      expect(verdict.allowed, `ADMIN 对超管 ${action}`).toBe(false);
      expect(verdict.reason).toBe("普通管理员不能操作超级管理员账号");
    }
  });
});

describe("canActOn — 超级管理员（SUPER_ADMIN）", () => {
  it("对任意非自身目标的所有动作均放行", () => {
    for (const targetRole of ROLES) {
      for (const action of ACTIONS) {
        const verdict = canActOn(
          actor("SUPER_ADMIN"),
          target(targetRole),
          action
        );
        expect(verdict.allowed, `超管对 ${targetRole} ${action}`).toBe(true);
      }
    }
  });
});

describe("isSuperOnlyAction", () => {
  it("role / ban / password 为超管专属，update / credits 不是", () => {
    expect(isSuperOnlyAction("role")).toBe(true);
    expect(isSuperOnlyAction("ban")).toBe(true);
    expect(isSuperOnlyAction("password")).toBe(true);
    expect(isSuperOnlyAction("update")).toBe(false);
    expect(isSuperOnlyAction("credits")).toBe(false);
  });
});

describe("parseUserSort", () => {
  it("接受白名单字段", () => {
    expect(parseUserSort("createdAt")).toBe("createdAt");
    expect(parseUserSort("credits")).toBe("credits");
    expect(parseUserSort("lastLoginAt")).toBe("lastLoginAt");
  });

  it("非法 / 缺失值回落 createdAt", () => {
    expect(parseUserSort(null)).toBe("createdAt");
    expect(parseUserSort("")).toBe("createdAt");
    expect(parseUserSort("password")).toBe("createdAt");
    expect(parseUserSort("id; DROP TABLE users")).toBe("createdAt");
  });

  it("忽略首尾空白", () => {
    expect(parseUserSort("  credits  ")).toBe("credits");
  });
});
