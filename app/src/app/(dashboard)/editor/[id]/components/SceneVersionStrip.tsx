"use client";

import { Check, History, Loader2, Sparkles } from "lucide-react";
import { useSceneVersions } from "../hooks/use-scene-versions";
import { useToast } from "@/components/ui/toast";

interface SceneVersionStripProps {
  sceneId: string;
  projectId: string;
  /** 当前分镜图 URL（用于高亮匹配，切换后由 project 缓存刷新） */
  currentImageUrl: string | null;
  /** 生成/切换进行中时禁用交互 */
  isBusy: boolean;
}

/**
 * 分镜版本历史条：横向排列历次生成结果缩略图，当前版本高亮，
 * 点击「设为当前」可回退/切换。仅有多个版本时才渲染（单版本无对比意义）。
 */
export function SceneVersionStrip({
  sceneId,
  projectId,
  currentImageUrl,
  isBusy,
}: SceneVersionStripProps) {
  const { versions, setCurrentVersion } = useSceneVersions(sceneId, projectId);
  const toast = useToast();

  // 单版本或空：无对比价值，不渲染
  if (versions.length <= 1) return null;

  const switching = setCurrentVersion.isPending;

  // 推荐张：VLM 分数最高的版本（多候选抽卡的择优张）。全部无分数时不标推荐。
  const topScore = versions.reduce<number | null>((max, v) => {
    if (typeof v.vlmScore !== "number") return max;
    return max === null || v.vlmScore > max ? v.vlmScore : max;
  }, null);
  const recommendedId =
    topScore === null
      ? null
      : versions.find((v) => v.vlmScore === topScore)?.id;

  const handleSetCurrent = (attemptId: string) => {
    setCurrentVersion.mutate(
      { attemptId },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "切换版本失败"),
      }
    );
  };

  return (
    <div className="border-border bg-card/50 mb-4 rounded-lg border p-2">
      <div className="mb-1.5 flex items-center gap-1">
        <History size={12} className="text-muted-foreground" />
        <span className="text-muted-foreground text-xs">
          版本历史（{versions.length}）
        </span>
        <span className="text-muted-foreground ml-auto text-[10px]">
          点击缩略图设为当前版本
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {versions.map((v) => {
          // isCurrent（服务端标记）优先；切换瞬间 project 缓存可能未刷新，
          // 用 currentImageUrl 兜底匹配，保证高亮即时反映
          const active = v.isCurrent || v.outputUrl === currentImageUrl;
          return (
            <button
              key={v.id}
              type="button"
              title={v.note || `版本 #${v.attemptNumber}`}
              disabled={active || isBusy || switching}
              onClick={() => handleSetCurrent(v.id)}
              className="group relative flex-shrink-0 disabled:cursor-default"
            >
              <div className="relative">
                <img
                  src={v.outputUrl}
                  alt={`版本 ${v.attemptNumber}`}
                  className={`h-16 w-16 rounded-md border-2 object-cover transition ${
                    active
                      ? "border-primary"
                      : "border-border group-hover:border-muted-foreground opacity-80 group-hover:opacity-100"
                  }`}
                />
                {/* 版本号角标 */}
                <span className="bg-background/80 text-foreground absolute bottom-0.5 left-0.5 rounded px-1 text-[9px] leading-tight">
                  #{v.attemptNumber}
                </span>
                {/* VLM 分数徽章（多候选抽卡时有值） */}
                {typeof v.vlmScore === "number" && (
                  <span
                    className={`absolute right-0.5 bottom-0.5 flex items-center gap-0.5 rounded px-1 text-[9px] leading-tight ${
                      v.id === recommendedId
                        ? "bg-agent text-agent-foreground"
                        : "bg-background/80 text-foreground"
                    }`}
                    title={
                      v.id === recommendedId
                        ? "AI 择优推荐张"
                        : `AI 评分 ${v.vlmScore}`
                    }
                  >
                    <Sparkles size={8} />
                    {v.vlmScore}
                  </span>
                )}
                {/* 当前版本对勾 */}
                {active && (
                  <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full">
                    <Check size={10} />
                  </span>
                )}
                {/* 切换加载态遮罩（仅目标项） */}
                {switching && !active && (
                  <span className="bg-background/60 absolute inset-0 flex items-center justify-center rounded-md">
                    <Loader2 size={14} className="animate-spin" />
                  </span>
                )}
              </div>
              {/* note 摘要（有追加指令的迭代版本） */}
              {v.note && (
                <span className="text-muted-foreground mt-0.5 block max-w-[64px] truncate text-[9px]">
                  {v.note}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
