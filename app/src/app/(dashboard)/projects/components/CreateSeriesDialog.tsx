"use client";

/**
 * CreateSeriesDialog — 新建漫剧系列弹窗
 *
 * 系列承载多集共享的世界观/主角/风格/画幅；支持把一个已有独立项目
 * 收编为第 1 集（服务端会同时继承其风格与最新短剧脚本的世界观）。
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Clapperboard, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { draftWorldview } from "@/lib/assist-client";
import type { ProjectListItem, SeriesSummary } from "@/types";

/** 世界观框内容达到此长度即视为「已较完整」，AI 起草前需二次确认（会覆盖） */
const WORLDVIEW_DRAFT_THRESHOLD = 50;

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

  // 世界观 AI 起草（批次 1 · 1.1）：世界观框短文本当想法扩写，
  // 替换世界观 + 只回填空的 title(片名)/genre/protagonist。
  const [drafting, setDrafting] = useState(false);

  const handleDraftWorldview = async () => {
    if (drafting) return;
    const idea = worldview.trim();
    if (!idea) {
      toast.info("请先在世界观框里写一句话想法，AI 会帮你扩写");
      return;
    }
    if (idea.length >= WORLDVIEW_DRAFT_THRESHOLD) {
      const ok = await toast.confirm(
        "世界观框已有较完整内容，AI 起草将覆盖它（作为想法扩写）。确认继续？"
      );
      if (!ok) return;
    }
    setDrafting(true);
    try {
      const draft = await draftWorldview({
        idea,
        genre: genre.trim() || undefined,
      });
      setWorldview(draft.worldview);
      // 仅回填空字段，非空不动
      if (!protagonist.trim()) setProtagonist(draft.protagonist);
      if (!genre.trim()) setGenre(draft.genre);
      if (!title.trim()) setTitle(draft.filmTitle);
      toast.success("已起草世界观，可继续修改");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "世界观起草失败");
    } finally {
      setDrafting(false);
    }
  };

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
            <div className="mb-1 flex items-center justify-between">
              <label className="text-muted-foreground block text-sm">
                世界观（每集短剧脚本自动预填）
              </label>
              <button
                type="button"
                onClick={handleDraftWorldview}
                disabled={drafting || createMutation.isPending}
                className="border-agent/40 bg-agent/10 text-agent hover:bg-agent/20 flex items-center gap-1 rounded px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-60"
                title="写一句话想法，AI 帮你扩写成完整世界观（并回填空的片名/类型/主角）"
              >
                {drafting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Wand2 size={11} />
                )}
                {drafting ? "起草中..." : "✨ AI 起草"}
              </button>
            </div>
            <textarea
              value={worldview}
              onChange={(e) => setWorldview(e.target.value)}
              placeholder="写一句话想法（如：重生复仇爽剧，女主是被陷害的豪门千金），点「✨ AI 起草」扩写；或直接输入完整世界观…"
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
