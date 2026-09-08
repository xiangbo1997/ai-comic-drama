"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { Loader2, ImageIcon } from "lucide-react";
import type { CoverSourceCandidate } from "./types";

/**
 * 平台封面区块（专属封面生成）：底图下拉（分镜图 / 角色定妆图）+ 标题/副题输入
 * （预填缺省值）+「生成封面」按钮 + 生成后预览与「重新生成」。
 * 调 POST /api/projects/[id]/cover（免费，不扣积分），成功后 invalidate 项目查询
 * 让主编辑器/列表卡缩略图同步更新。
 */
export function CoverPanel({
  projectId,
  candidates,
  defaultTitle,
  defaultSubtitle,
  initialCoverUrl,
}: {
  projectId: string;
  candidates: CoverSourceCandidate[];
  defaultTitle: string;
  defaultSubtitle: string;
  initialCoverUrl?: string | null;
}) {
  const queryClient = useQueryClient();
  // 底图选择：默认走后端缺省解析（主角定妆图优先），空串表示「自动」
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [subtitle, setSubtitle] = useState(defaultSubtitle);
  const [coverUrl, setCoverUrl] = useState<string | null>(
    initialCoverUrl ?? null
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 空串=让后端自动解析底图；标题/副题空则后端用缺省
          sourceImageUrl: sourceUrl || undefined,
          title: title.trim() || undefined,
          subtitle: subtitle.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        coverImageUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.coverImageUrl) {
        throw new Error(data.error || "封面生成失败");
      }
      return data.coverImageUrl;
    },
    onSuccess: (url) => {
      setCoverUrl(url);
      // 主编辑器/项目列表缩略图同步刷新
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const hasCandidates = candidates.length > 0;

  return (
    <div className="space-y-3">
      {!hasCandidates && (
        <p className="text-muted-foreground text-sm">
          暂无可用底图，请先生成分镜图或角色定妆图。
        </p>
      )}

      {hasCandidates && (
        <>
          {/* 底图选择 */}
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              底图
            </label>
            <select
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
            >
              <option value="">自动（主角定妆图优先）</option>
              {candidates.map((c) => (
                <option key={c.url} value={c.url}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* 标题 */}
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              主标题（剧名）
            </label>
            <input
              type="text"
              value={title}
              maxLength={40}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultTitle || "输入封面剧名"}
              className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
            />
          </div>

          {/* 副题 */}
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              副标题（可选，如「第 N 集」）
            </label>
            <input
              type="text"
              value={subtitle}
              maxLength={30}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="留空则不显示副标题"
              className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
            />
          </div>

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-primary hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ImageIcon size={15} />
            )}
            {coverUrl ? "重新生成封面" : "生成封面"}
          </button>

          {mutation.isError && (
            <p className="text-sm text-red-400">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "封面生成失败"}
            </p>
          )}

          {/* 预览（竖屏，限高）：同源 /uploads 走 next/image，外链（R2）回退原生 img
              （与 ProjectCard 缩略图同一约定，避开 remotePatterns 配置） */}
          {coverUrl && (
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <div className="border-border relative h-64 w-36 overflow-hidden rounded-lg border">
                {coverUrl.startsWith("/") ? (
                  <Image
                    src={coverUrl}
                    alt="封面预览"
                    fill
                    sizes="144px"
                    className="object-cover"
                  />
                ) : (
                  <img
                    src={coverUrl}
                    alt="封面预览"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                封面已生成，将用于成片片头与项目缩略图
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
