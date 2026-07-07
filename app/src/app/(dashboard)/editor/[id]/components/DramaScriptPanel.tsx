"use client";

import { useState } from "react";
import { Sparkles, Loader2, FileText, ListVideo } from "lucide-react";
import type {
  ProjectDetail,
  DramaScriptArtifact,
  StoryboardTableArtifact,
} from "@/types";
import { dramaScriptToScenes, scriptToInputText } from "@/lib/drama-to-scenes";
import {
  useDramaScript,
  type ShortDramaScriptRecord,
} from "../hooks/use-drama-script";
import { StoryboardTablePanel } from "./StoryboardTablePanel";

interface DramaScriptPanelProps {
  projectId: string;
  project: ProjectDetail;
  /** 把生成的脚本「应用为分镜原文」回填到输入框，串到现有 parse 流程 */
  onApplyAsInput?: (text: string) => void;
  /** 结构化直转分镜列表（零 LLM；九宫格镜头语言自动合入） */
  onApplyToScenes?: (
    scenes: Record<string, unknown>[],
    sourceText: string
  ) => void;
  isApplyingToScenes?: boolean;
}

export function DramaScriptPanel({
  projectId,
  project,
  onApplyAsInput,
  onApplyToScenes,
  isApplyingToScenes,
}: DramaScriptPanelProps) {
  const { scripts, generateMutation, updateMutation } =
    useDramaScript(projectId);

  // 系列内的集：世界观/主角自动预填系列设定（挂载时一次性初始化，
  // 用户可自由改写，不会被后续 refetch 覆盖）
  const [worldview, setWorldview] = useState(project.series?.worldview ?? "");
  const [protagonist, setProtagonist] = useState(
    project.series?.protagonist ?? ""
  );
  const [durationSec, setDurationSec] = useState(90);

  const latest: ShortDramaScriptRecord | undefined = scripts[0];
  const latestDoc = latest?.scriptDoc as DramaScriptArtifact | undefined;

  const handleGenerate = () => {
    if (!worldview.trim()) return;
    generateMutation.mutate({
      worldview: worldview.trim(),
      protagonist: protagonist.trim() || undefined,
      durationSec,
      aspectRatio: project.aspectRatio,
      style: project.style,
      characterNames: project.characters.map((c) => c.character.name),
    });
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-agent" />
        <h3 className="text-sm font-semibold">世界观创作</h3>
        <span className="text-muted-foreground text-xs">
          根据世界观生成结构化短剧脚本
        </span>
      </div>

      {/* 系列续集提示：服务端会自动取上一集剧情做前情提要注入生成 */}
      {project.series && (project.episodeNumber ?? 0) > 1 && (
        <p className="bg-agent/10 text-agent rounded-lg px-3 py-2 text-xs">
          本集是「{project.series.title}」第 {project.episodeNumber} 集：
          生成脚本时将自动衔接上一集的剧情结尾，无需手动写前情提要
        </p>
      )}

      <textarea
        value={worldview}
        onChange={(e) => setWorldview(e.target.value)}
        placeholder="输入世界观设定，如：在由群岛、高空洋流与古代遗迹组成的世界「苍潮界」中，传说有一条失落的古代航路…"
        className="bg-card focus:ring-primary h-24 w-full resize-none rounded-lg p-3 text-sm focus:ring-2 focus:outline-none"
      />

      <div className="flex gap-2">
        <input
          value={protagonist}
          onChange={(e) => setProtagonist(e.target.value)}
          placeholder="主角身份（可选）"
          className="bg-card focus:ring-primary flex-1 rounded-lg p-2 text-sm focus:ring-2 focus:outline-none"
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={10}
            max={600}
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value) || 90)}
            className="bg-card focus:ring-primary w-16 rounded-lg p-2 text-sm focus:ring-2 focus:outline-none"
          />
          <span className="text-muted-foreground text-xs">秒</span>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!worldview.trim() || generateMutation.isPending}
        className="bg-agent text-agent-foreground disabled:bg-secondary disabled:text-foreground flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition hover:opacity-90 disabled:cursor-not-allowed"
      >
        {generateMutation.isPending ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Sparkles size={18} />
        )}
        {generateMutation.isPending ? "生成中（约1分钟）..." : "生成短剧脚本"}
      </button>

      {generateMutation.isError && (
        <p className="text-center text-xs text-red-400">
          {(generateMutation.error as Error)?.message ?? "生成失败"}
        </p>
      )}

      {/* 最新脚本展示 + 打磨 */}
      {latestDoc && (
        <div className="border-border space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-muted-foreground" />
              <span className="text-sm font-medium">
                《{latestDoc.filmTitle}》
              </span>
              <span className="text-muted-foreground text-xs">
                v{latest?.version} · {latestDoc.genre} · {latestDoc.durationSec}
                s
              </span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{latestDoc.logline}</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {latestDoc.scenes?.map((s) => (
              <div
                key={s.index}
                className="bg-card/50 rounded p-2 text-xs"
                title={s.description}
              >
                <span className="font-medium">
                  {s.index}. {s.title}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {s.durationSec}s
                </span>
                <p className="text-muted-foreground mt-0.5 line-clamp-2">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            {onApplyToScenes && (
              <button
                onClick={() =>
                  onApplyToScenes(
                    dramaScriptToScenes(
                      latestDoc,
                      latest?.storyboard as StoryboardTableArtifact | null,
                      project.characters.map((c) => c.character.name)
                    ),
                    scriptToInputText(latestDoc)
                  )
                }
                disabled={isApplyingToScenes || updateMutation.isPending}
                className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs transition disabled:cursor-not-allowed"
              >
                {isApplyingToScenes ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ListVideo size={13} />
                )}
                {isApplyingToScenes ? "生成中..." : "直接生成分镜列表"}
              </button>
            )}
            {onApplyAsInput && (
              <button
                onClick={() => onApplyAsInput(scriptToInputText(latestDoc))}
                disabled={updateMutation.isPending}
                className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg px-3 py-2 text-xs transition"
              >
                应用为分镜原文
              </button>
            )}
          </div>
          {onApplyToScenes && (
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              「直接生成」按脚本结构直转分镜（含九宫格镜头语言），不耗积分；
              「应用为分镜原文」回填文本框，可手动编辑后再智能拆解
            </p>
          )}
        </div>
      )}

      {/* 阶段2+3：九宫格分镜表（消费已生成的脚本） */}
      {latest && <StoryboardTablePanel projectId={projectId} script={latest} />}
    </div>
  );
}
