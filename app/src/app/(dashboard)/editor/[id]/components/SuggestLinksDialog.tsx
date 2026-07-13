"use client";

/**
 * AI 尾帧衔接建议弹窗（计划 §5 · 2.1 · 任务 C）
 *
 * 点「AI 建议衔接」→ POST suggest-links 取相邻镜衔接建议 →
 * 弹窗列出「镜 N → 镜 N+1 + 理由」，「全部应用」→ PUT 批量开启 videoLinkNext →
 * 刷新项目 + 成功 toast。建议态是临时的（仅存在于本弹窗，不落库为"建议中"）。
 *
 * flSupported=false 时展示非阻断提示：当前视频模型不支持首尾帧插值，
 * 衔接开启后将回落普通生成（降级不阻断，与统一交互原则一致）。
 */

import { useEffect, useState } from "react";
import { Loader2, Link2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  suggestLinks,
  applyLinks,
  type LinkSuggestion,
} from "@/lib/assist-client";
import type { Scene } from "@/types";

interface SuggestLinksDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 分镜列表（按 order），用来把 sceneId 映射成「镜 N → 镜 N+1」序号展示 */
  scenes: Scene[];
  /** 应用成功后回调（刷新项目查询） */
  onApplied: () => void;
}

export function SuggestLinksDialog({
  open,
  onClose,
  projectId,
  scenes,
  onApplied,
}: SuggestLinksDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[] | null>(null);
  const [flSupported, setFlSupported] = useState(true);

  // sceneId → 序号（镜 N，1 起）映射，供理由行展示
  const orderMap = new Map(scenes.map((s, i) => [s.id, i + 1]));

  // 打开弹窗即拉建议（open 由外部按钮控制，onOpenChange 不会为外部开启触发，
  // 故用 effect 监听 open）。竞态守卫：卸载/关闭后不再 setState。
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setSuggestions(null);
    suggestLinks(projectId)
      .then((res) => {
        if (!active) return;
        setSuggestions(res.suggestions);
        setFlSupported(res.flSupported);
      })
      .catch((err) => {
        if (!active) return;
        toast.error(err instanceof Error ? err.message : "衔接建议失败");
        onClose();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // toast/onClose 引用稳定；仅在 open/projectId 变化时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const handleApplyAll = async () => {
    if (!suggestions || suggestions.length === 0) return;
    setApplying(true);
    try {
      const sceneIds = suggestions.map((s) => s.sceneId);
      const { updated } = await applyLinks(projectId, sceneIds);
      onApplied();
      toast.success(`已开启 ${updated} 处衔接`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "应用衔接失败");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 外部按钮控制开启；此处只处理关闭（overlay/Esc/关闭按钮）
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 size={18} className="text-primary" />
            AI 建议衔接
          </DialogTitle>
          <DialogDescription>
            AI 判断相邻分镜是否同场景且动作连续，建议开启尾帧衔接实现无缝过渡。
          </DialogDescription>
        </DialogHeader>

        {/* 视频模型不支持 FL 时的非阻断提示 */}
        {!flSupported && (
          <div className="bg-primary/10 text-muted-foreground flex items-start gap-2 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              当前视频模型不支持首尾帧插值，衔接开启后将回落普通生成。
            </span>
          </div>
        )}

        <div className="max-h-72 min-h-24 overflow-y-auto">
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 size={16} className="animate-spin" />
              AI 分析中…
            </div>
          ) : suggestions && suggestions.length > 0 ? (
            <ul className="space-y-2">
              {suggestions.map((s) => {
                const from = orderMap.get(s.sceneId);
                const to = orderMap.get(s.nextSceneId);
                return (
                  <li
                    key={s.sceneId}
                    className="bg-secondary/50 rounded-lg px-3 py-2 text-sm"
                  >
                    <div className="text-foreground flex items-center gap-1.5 font-medium">
                      <Link2 size={13} className="text-primary" />镜{" "}
                      {from ?? "?"} → 镜 {to ?? "?"}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {s.reason}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
              没有找到适合衔接的相邻分镜
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>
            取消
          </Button>
          <Button
            onClick={handleApplyAll}
            disabled={
              loading || applying || !suggestions || suggestions.length === 0
            }
          >
            {applying ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link2 size={14} />
            )}
            全部应用
            {suggestions && suggestions.length > 0
              ? `（${suggestions.length}）`
              : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
