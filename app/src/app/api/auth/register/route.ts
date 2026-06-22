import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:auth:register");

export async function POST(request: NextRequest) {
  try {
    // 限流（按 IP）：防批量注册刷邀请奖励 + 防 bcrypt DoS
    const rl = await rateLimiters.auth(request);
    if (!rl.success) {
      return NextResponse.json(
        { error: "注册请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const { email, password, name } = await request.json();

    // 验证输入
    if (!email || !password) {
      return NextResponse.json(
        { error: "邮箱和密码不能为空" },
        { status: 400 }
      );
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }

    // 验证密码长度（下限防弱口令；上限防 bcrypt 超长输入 DoS，
    // bcrypt 对 72 字节以上静默截断，128 是友好上限）
    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "密码至少需要6个字符" },
        { status: 400 }
      );
    }
    if (password.length > 128) {
      return NextResponse.json(
        { error: "密码不能超过128个字符" },
        { status: 400 }
      );
    }

    const result = await registerUser(email, password, name);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, userId: result.userId });
  } catch (error) {
    log.error("Register API error:", error);
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 }
    );
  }
}
