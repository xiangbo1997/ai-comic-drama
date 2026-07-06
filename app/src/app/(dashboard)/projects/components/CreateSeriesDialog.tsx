"use client";

/**
 * CreateSeriesDialog — 新建漫剧系列弹窗
 *
 * 系列承载多集共享的世界观/主角/风格/画幅；支持把一个已有独立项目
 * 收编为第 1 集（服务端会同时继承其风格与最新短剧脚本的世界观）。
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Clapperboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { ProjectListItem, SeriesSummary } from "@/types";

const STYLES: Array<{ value: string; label: string }> = [
  { value: "anime", label: "日漫风格" },
  { value: "realistic", label: "写实风格" },
  { value: "comic", label: "漫画风格" },
  { value: "watercolor", label: "水彩风格" },
];

const ASPECT_RATIOS: Array<{ value: string; label: string }> = [
  { value: "9:16", label: "9:16 (竖屏)" },
  { value: "16:9", label: "16:9 (横屏)" },
  { value: "1:1", label: "1:1 (方形)" },
];

interface CreateSeriesDialogProps {
  /** 可被收编为第 1 集的独立项目（未加入任何系列） */
  standaloneProjects: ProjectListItem[];
  onClose: () => void;
  onCreated: (series: SeriesSummary) => void;
}

async function createSeries(body: Record<string, unknown>) {
  const res = await fetch("/api/series", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || "创建系列失败");
  }
  return res.json() as Promise<SeriesSummary>;
}

export function CreateSeriesDialog({
  standaloneProjects,
  onClose,
  onCreated,
}: CreateSeriesDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [style, setStyle] = useState("anime");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [worldview, setWorldview] = useState("");
  const [protagonist, setProtagonist] = useState("");
  const [fromProjectId, setFromProjectId] = useState("");

  const createMutation = useMutation({
    mutationFn: createSeries,
    onSuccess: (series) => {
      queryClient.invalidateQueries({ queryKey: ["series"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`系列「${series.title}」已创建`);
      onCreated(series);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "创建系列失败");
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) return;
    createMutation.mutate({
      title: title.trim(),
      genre: genre.trim() || undefined,
      style,
      aspectRatio,
      worldview: worldview.trim() || undefined,
      protagonist: protagonist.trim() || undefined,
      fromProjectId: fromProjectId || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard size={18} />
            新建系列
          </DialogTitle>
          <DialogDescription>
            系列统一管理多集的世界观、主角与画风；新建一集时自动继承这些设定和上一集的角色阵容
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              系列名称 <span className="text-destructive">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：苍潮界"
              className="bg-card focus:ring-primary w-full rounded-lg p-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-muted-foreground mb-1 block text-sm">
                类型
              </label>
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="如：玄幻冒险"
                className="bg-card focus:ring-primary w-full rounded-lg p-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                风格
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="bg-card rounded-lg p-2 text-sm"
              >
                {STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                画幅
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="bg-card rounded-lg p-2 text-sm"
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              世界观（每集短剧脚本自动预填）
            </label>
            <textarea
              value={worldview}
              onChange={(e) => setWorldview(e.target.value)}
              placeholder="输入系列共享的世界观设定…"
              className="bg-card focus:ring-primary h-20 w-full resize-none rounded-lg p-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              主角设定
            </label>
            <input
              value={protagonist}
              onChange={(e) => setProtagonist(e.target.value)}
              placeholder="主角身份（可选）"
              className="bg-card focus:ring-primary w-full rounded-lg p-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          {standaloneProjects.length > 0 && (
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                从现有项目导入为第 1 集（可选）
              </label>
              <select
                value={fromProjectId}
                onChange={(e) => setFromProjectId(e.target.value)}
                className="bg-card w-full rounded-lg p-2 text-sm"
              >
                <option value="">不导入，从空系列开始</option>
                {standaloneProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-xs">
                导入后该项目成为第 1
                集，系列自动继承它的风格、画幅与最新短剧脚本的世界观
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="bg-secondary hover:bg-secondary/80 rounded-lg px-4 py-2 text-sm transition"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || createMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createMutation.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              创建系列
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
