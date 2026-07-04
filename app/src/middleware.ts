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
  // 注意：路由分组 (dashboard) 不出现在真实 URL 中，原 matcher
  // "/(dashboard)/:path*" 在 path-to-regexp 里是正则分组、只匹配字面
  // /dashboard/**——即本 middleware 此前从未执行过（E2E 冒烟发现），
  // callbackUrl 一直没被设置，未登录重定向全靠 layout 兜底（不带回跳）。
  // 改为显式列出受保护路径前缀（:path* 允许零段，/projects 本身也命中）。
  matcher: [
    "/projects/:path*",
    "/characters/:path*",
    "/editor/:path*",
    "/credits/:path*",
    "/settings/:path*",
    "/admin/:path*",
  ],
};
