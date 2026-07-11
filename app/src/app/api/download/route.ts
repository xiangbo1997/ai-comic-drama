import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { safeDownload } from "@/lib/url-guard";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:download");

// 导出视频 200MB 上限（与上传 video maxBytes 对齐）
const MAX_BYTES = 200 * 1024 * 1024;

/**
 * 服务端下载代理（GET /api/download?url=...）。
 *
 * 背景：导出视频存在 R2（pub-*.r2.dev），浏览器直接 fetch 跨域被 CORS 拦
 * （R2 bucket 未配 CORS）→ 前端 "Failed to fetch"。改由服务端拉取（无浏览器
 * 跨域限制）+ Content-Disposition: attachment 头，前端 <a> 指向本接口即触发下载。
 *
 * 安全：
 * - 校验 session（登录用户才可下载）
 * - 只放行 R2 公开域前缀（R2_PUBLIC_URL），避免沦为任意 URL 代理（SSRF/滥用）
 * - safeDownload 钉 IP + 手动跟随重定向（防 DNS rebinding / 重定向绕过）
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = request.nextUrl.searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
    }

    // 只允许下载 R2 公开域下的文件，防止本接口被当作任意 URL 代理
    const publicPrefix = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
    if (!publicPrefix || !url.startsWith(publicPrefix)) {
      log.warn(`拒绝下载非 R2 公开域 URL: ${url.slice(0, 80)}`);
      return NextResponse.json({ error: "不允许下载该地址" }, { status: 403 });
    }

    const { buffer, contentType } = await safeDownload(url, {
      maxBytes: MAX_BYTES,
    });

    // 从 URL 取文件名，确保 .mp4 后缀
    const nameFromUrl = url.split("/").pop()?.split("?")[0] || "";
    const fileName = /\.\w+$/.test(nameFromUrl)
      ? nameFromUrl
      : `video_${nameFromUrl || "export"}.mp4`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType || "video/mp4",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("下载代理失败:", error);
    return NextResponse.json({ error: "下载失败，请重试" }, { status: 502 });
  }
}
