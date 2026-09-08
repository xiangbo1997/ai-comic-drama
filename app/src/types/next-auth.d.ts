/**
 * NextAuth v5 类型增强
 *
 * 把 RBAC 所需字段抬进 Session 的类型里，避免调用方到处写 `as UserRole` 断言：
 * - `session.user.id`：项目原本就在 session callback 里注入，此前只是靠
 *   NextAuth 默认的宽松 user 类型蒙混过关，这里显式声明。
 * - `session.user.role` / `status`：后台鉴权与「后台管理」入口的显隐依据，
 *   由 jwt callback 从 DB 读入并周期性复查（见 lib/auth.ts）。
 *
 * ⚠️ 为什么**没有** JWT 的模块增强：`JWT` 接口定义在 `@auth/core/jwt`
 * （`next-auth/jwt` 只是 `export *` 的转发壳，向它声明合并不生效），而
 * `@auth/core` 是 next-auth 的传递依赖，在 pnpm 的隔离 node_modules 下无法
 * 从本包解析，`declare module "@auth/core/jwt"` 会被判为「模块不存在」。
 * 好在 `JWT extends Record<string, unknown>`，token 上读写自定义字段本就
 * 合法，只是取出来是 `unknown`；lib/auth.ts 里用 `AdminTokenFields` 局部
 * 收窄，把不安全的断言收敛在一处而不是散落各调用点。
 */

import type { UserRole, UserStatus } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      status: UserStatus;
    } & DefaultSession["user"];
  }
}

export {};
