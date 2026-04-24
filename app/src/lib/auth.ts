import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

import { createLogger } from "@/lib/logger";
const log = createLogger("lib:auth");

const INVITE_REWARD = 50;

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
        });

        if (!user || !user.password) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
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

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || email.split("@")[0],
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
          // 更新被邀请人
          await prisma.user.update({
            where: { id: user.id },
            data: { invitedBy: inviter.id },
          });

          // 创建邀请记录
          await prisma.invitation.create({
            data: {
              inviterId: inviter.id,
              inviteeId: user.id,
              inviteeEmail: user.email,
              credits: INVITE_REWARD,
              status: "COMPLETED",
              completedAt: new Date(),
            },
          });

          // 给邀请人增加积分
          await prisma.user.update({
            where: { id: inviter.id },
            data: { credits: { increment: INVITE_REWARD } },
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
