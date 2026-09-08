"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Download, Clapperboard } from "lucide-react";

/**
 * 剪映草稿导出区块：把项目组装成剪映草稿 zip（时间轴 + 全部素材 + 使用说明），
 * 用户解压到剪映草稿目录即可打开继续精修。调 POST /api/projects/[id]/draft-export
 * （免费，不扣积分），成功后给下载链接。zip 即时返回不落库，故每次点击都重新打包。
 */
export function JianyingDraftPanel({ projectId }: { projectId: string }) {
  const [zipUrl, setZipUrl] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/draft-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        zipUrl?: string;
        sizeBytes?: number;
        error?: string;
      };
      if (!res.ok || !data.zipUrl) {
        throw new Error(data.error || "剪映草稿导出失败");
      }
      return data.zipUrl;
    },
    onSuccess: (url) => setZipUrl(url),
  });

  // 下载：本地降级产物是 /uploads/... 同源路径，直接 <a download>；R2 外链走同源
  // 下载代理（避开跨域 CORS），与视频下载同一约定。
  const handleDownload = (url: string) => {
    const a = document.createElement("a");
    a.href = url.startsWith("/")
      ? url
      : `/api/download?url=${encodeURIComponent(url)}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        导出剪映草稿包（含时间轴 + 全部素材 +
        字幕），解压到剪映草稿目录即可打开继续精修。
      </p>

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="bg-primary hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
      >
        {mutation.isPending ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Clapperboard size={15} />
        )}
        {mutation.isPending ? "正在打包草稿..." : "导出剪映草稿"}
      </button>

      {mutation.isError && (
        <p className="text-sm text-red-400">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "剪映草稿导出失败"}
        </p>
      )}

      {zipUrl && (
        <button
          type="button"
          onClick={() => handleDownload(zipUrl)}
          className="bg-secondary hover:bg-secondary/80 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition"
        >
          <Download size={15} />
          下载草稿包（.zip）
        </button>
      )}

      <p className="text-muted-foreground text-xs">
        兼容剪映专业版 5.9+ 与
        CapCut；新版剪映可直接打开，保存后草稿会被剪映加密属正常现象。
      </p>
    </div>
  );
}
