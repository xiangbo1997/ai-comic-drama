import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 轻量级中间件：仅检查 NextAuth session cookie 是否存在
 *
 * 职责单一：未登录立即 302 跳 /login，登录用户放行进入 Node Runtime 渲染
 * 不引入 Node-only 模块（bcrypt/Prisma/crypto），避免 Edge Runtime 报错
 * 真正的鉴权（DB 查询 + session 解析）下沉到 (dashboard)/layout.tsx 的 RSC 层
 */
const SESSION_COOKIES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

export function middleware(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));

  if (!hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/(dashboard)/:path*"],
};
