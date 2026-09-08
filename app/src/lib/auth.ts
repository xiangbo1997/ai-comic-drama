import NextAuth from "next-auth";
import type { UserRole, UserStatus } from "@prisma/client";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { grantCredits } from "@/lib/credits";
import { getSystemConfig } from "@/lib/system-config";
import { cookies } from "next/headers";

import { createLogger } from "@/lib/logger";
const log = createLogger("lib:auth");

/** JWT 内角色/状态的复查窗口：超过该间隔就回库刷新一次（见 jwt callback） */
const ROLE_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * JWT 上自定义字段的收窄视图。
 *
 * NextAuth 的 `JWT extends Record<string, unknown>`，直接读 `token.role` 得到
 * `unknown`；而 `JWT` 定义在无法从本包解析的 `@auth/core/jwt`，声明合并这条路
 * 走不通（详见 types/next-auth.d.ts）。故只在两个 callback 入口各断言一次，
 * 把不安全性收敛到这里。
 */
interface JwtFields {
  id?: string;
  role?: UserRole;
  status?: UserStatus;
  /** 上次从 DB 复查角色/状态的时间戳（毫秒） */
  roleCheckedAt?: number;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            password: true,
            role: true,
            status: true,
          },
        });

        if (!user || !user.password) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          return null;
        }

        // 封禁账号一律拒绝登录。刻意与「密码错误」返回同样的 null——登录页
        // 只提示「邮箱或密码错误」，不向未持有凭据者暴露该邮箱已被封禁。
        // 已封禁用户的存量 JWT 由下方 jwt callback 的周期复查踢出。
        if (user.status === "BANNED") {
          return null;
        }

        // 记录最近登录时间供后台活跃度统计；失败不应阻断登录
        await prisma.user
          .update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
          .catch((error: unknown) => {
            log.warn("更新 lastLoginAt 失败（不阻断登录）:", error);
          });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          status: user.status,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      // JWT 的自定义字段在类型上是 unknown（见 types/next-auth.d.ts 的说明），
      // 这里用一个收窄视图集中处理，全文件只此一处断言。
      const t = token as JwtFields;

      if (user) {
        t.id = user.id;
        // 登录瞬间强制复查一次：authorize 返回的扩展字段在 NextAuth 的 User
        // 类型里不可见，清空时间戳让下面的分支从库里现取，保证 token 一定
        // 带上 role/status（也覆盖将来可能接入的 OAuth 路径）。
        t.roleCheckedAt = undefined;
      }

      if (!t.id) return token;

      // JWT 会话不查库：管理员改了某人的角色 / 封了号，若不复查要等 token
      // 过期（默认 30 天）才生效。这里做 5 分钟窗口的惰性复查，
      // 兼顾「变更及时生效」与「不给每个请求加一次 DB 往返」。
      const now = Date.now();
      const stale =
        typeof t.roleCheckedAt !== "number" ||
        now - t.roleCheckedAt > ROLE_RECHECK_INTERVAL_MS;

      if (stale || trigger === "update") {
        const fresh = await prisma.user
          .findUnique({
            where: { id: t.id },
            select: { role: true, status: true },
          })
          .catch((error: unknown) => {
            log.warn("复查用户角色失败，沿用 token 内旧值:", error);
            return null;
          });

        if (fresh) {
          t.role = fresh.role;
          t.status = fresh.status;
          t.roleCheckedAt = now;
        }
      }

      return token;
    },
    async session({ session, token }) {
      const t = token as JwtFields;
      if (session.user && t.id) {
        session.user.id = t.id;
        session.user.role = t.role ?? "USER";
        session.user.status = t.status ?? "ACTIVE";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});

// 注册新用户
export async function registerUser(
  email: string,
  password: string,
  name?: string
): Promise<{ success: boolean; error?: string; userId?: string }> {
  try {
    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return { success: false, error: "该邮箱已被注册" };
    }

    // 哈希密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 初始积分走系统配置（schema 上的 @default(300) 保留为兜底，
    // 供不经本函数的直插数据使用；运营调价只需改 INITIAL_CREDITS）
    const initialCredits = await getSystemConfig("INITIAL_CREDITS");

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || email.split("@")[0],
        credits: initialCredits,
      },
    });

    // 处理邀请码
    try {
      const cookieStore = await cookies();
      const inviteCode = cookieStore.get("invite_code")?.value;

      if (inviteCode) {
        const inviter = await prisma.user.findUnique({
          where: { inviteCode },
        });

        if (inviter && inviter.id !== user.id) {
          // 邀请奖励额度走系统配置；双向激励（邀请人/被邀请人）取同一额度
          const INVITE_REWARD = await getSystemConfig("INVITE_REWARD");
          const INVITEE_REWARD = INVITE_REWARD;

          // 邀请处理三步包进同一事务，保证原子：更新被邀请人 + 创建邀请记录 + 给邀请人发奖励（经统一积分服务记流水）
          await prisma.$transaction(async (tx) => {
            await tx.user.update({
              where: { id: user.id },
              data: { invitedBy: inviter.id },
            });

            await tx.invitation.create({
              data: {
                inviterId: inviter.id,
                inviteeId: user.id,
                inviteeEmail: user.email,
                credits: INVITE_REWARD,
                status: "COMPLETED",
                completedAt: new Date(),
              },
            });

            await grantCredits(tx, {
              userId: inviter.id,
              amount: INVITE_REWARD,
              type: "INVITE",
              source: "invite",
              sourceId: user.id,
              note: "邀请新用户注册奖励",
            });

            // 双向激励：被邀请人也获得额外奖励（提升邀请链接接受率）
            await grantCredits(tx, {
              userId: user.id,
              amount: INVITEE_REWARD,
              type: "INVITE",
              source: "invite",
              sourceId: inviter.id,
              note: "通过邀请码注册奖励",
            });
          });
        }
      }
    } catch (error) {
      log.error("Error processing invite:", error);
    }

    return { success: true, userId: user.id };
  } catch (error) {
    log.error("Registration error:", error);
    return { success: false, error: "注册失败，请稍后重试" };
  }
}
