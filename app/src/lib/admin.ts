/**
 * 后台权限判定（RBAC）
 *
 * 权限真源是 `User.role`（USER / ADMIN / SUPER_ADMIN），不再是 env 白名单。
 * `ADMIN_EMAILS` 退化为**引导（bootstrap）通道**：全新部署时库里一个管理员
 * 都没有，把邮箱写进 env 后该用户首次访问后台即被自动提升为 SUPER_ADMIN
 * 并落审计日志。提升后 env 可以移除，权限继续由 DB 承载。
 *
 * 非管理员一律返回 **404 空响应**而非 403：后台路径不该被扫描器通过状态码
 * 区分「存在但没权限」与「不存在」。superOnly 的降级是例外——请求方已是
 * 管理员，告诉它「需要超管」是必要的可用性信息，不构成信息泄露。
 */

import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";

import { writeAuditLog } from "@/lib/admin-audit";
import { auth } from "@/lib/auth";
import { getAdminEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("lib:admin");

/** 已通过鉴权的管理员身份 */
export type AdminUser = {
  id: string;
  email: string;
  role: UserRole;
};

/** 读取 ADMIN_EMAILS 引导白名单（小写归一） */
function getBootstrapEmails(): string[] {
  const raw = getAdminEnv().ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 把 session 解析成管理员身份；不是管理员（或已封禁）返回 null。
 *
 * 刻意**每次都回库读 role**而不是信 session 里的值：撤销管理员权限必须立刻
 * 生效，不能等 JWT 的 5 分钟复查窗口。后台请求量小，这次 DB 往返可以接受。
 */
export async function resolveAdmin(
  session: Session | null
): Promise<AdminUser | null> {
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user
    .findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, status: true },
    })
    .catch((error: unknown) => {
      log.error("查询管理员身份失败:", error);
      return null;
    });

  if (!user) return null;

  // 封禁账号即便曾是管理员也一律拒绝
  if (user.status === "BANNED") return null;

  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
    return { id: user.id, email: user.email, role: user.role };
  }

  // 引导通道：env 白名单里的普通用户首次访问后台时自动升为超管
  const bootstrapEmails = getBootstrapEmails();
  if (bootstrapEmails.includes(user.email.toLowerCase())) {
    try {
      const promoted = await prisma.user.update({
        where: { id: user.id },
        data: { role: "SUPER_ADMIN" },
        select: { id: true, email: true, role: true },
      });

      await writeAuditLog(prisma, {
        actorId: promoted.id,
        action: "bootstrap.promote",
        targetType: "user",
        targetId: promoted.id,
        before: { role: user.role },
        after: { role: promoted.role },
        note: "ADMIN_EMAILS 环境变量引导提升为超级管理员",
      });

      log.info(`引导提升管理员：${promoted.email} → SUPER_ADMIN`);
      return { id: promoted.id, email: promoted.email, role: promoted.role };
    } catch (error) {
      log.error("引导提升管理员失败:", error);
      return null;
    }
  }

  return null;
}

/** requireAdmin 的返回：要么拿到管理员，要么拿到该直接返回给客户端的响应 */
export type RequireAdminResult =
  | { admin: AdminUser; response?: undefined }
  | { admin?: undefined; response: NextResponse };

/**
 * Route Handler 的管理员闸门。
 *
 * 用法：
 * ```ts
 * const gate = await requireAdmin();
 * if (gate.response) return gate.response;
 * const { admin } = gate;
 * ```
 *
 * @param opts.superOnly 仅超级管理员可用（改角色、改系统配置等高危操作）
 */
export async function requireAdmin(opts?: {
  superOnly?: boolean;
}): Promise<RequireAdminResult> {
  const session = await auth();
  const admin = await resolveAdmin(session);

  if (!admin) {
    // 伪装不存在：不区分「未登录」「已登录但非管理员」
    return { response: new NextResponse(null, { status: 404 }) };
  }

  if (opts?.superOnly && admin.role !== "SUPER_ADMIN") {
    return {
      response: NextResponse.json(
        { error: "需要超级管理员权限" },
        { status: 403 }
      ),
    };
  }

  return { admin };
}

/**
 * 兼容旧调用点的布尔判定。
 *
 * 新代码请用 `requireAdmin()`——它同时给出管理员身份（写审计日志需要 actorId）
 * 与标准化的拒绝响应。本函数仅供 cleanup 这类「双通道鉴权」的既有分支使用。
 */
export async function isAdmin(session: Session | null): Promise<boolean> {
  return (await resolveAdmin(session)) !== null;
}
