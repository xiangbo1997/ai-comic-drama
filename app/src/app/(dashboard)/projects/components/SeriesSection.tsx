"use client";

/**
 * SeriesSection — 项目列表页的系列分组区块
 *
 * 头部：系列名 + 类型/集数信息 + 解散系列；网格：各集卡片（按集数升序）
 * + 「新建一集」虚线卡（继承系列设定与上一集角色阵容）。
 */

import { Plus, Loader2, Clapperboard, Trash2 } from "lucide-react";
import type { ProjectListItem, SeriesSummary } from "@/types";
import { nextEpisodeNumber } from "@/lib/series";
import { ProjectCard } from "./ProjectCard";

export interface SeriesSectionProps {
  series: SeriesSummary;
  episodes: ProjectListItem[];
  deletingId: string | null;
  creatingEpisode: boolean;
  dissolving: boolean;
  onDeleteProject: (e: React.MouseEvent, project: ProjectListItem) => void;
  onCreateEpisode: (seriesId: string) => void;
  onDissolve: (series: SeriesSummary) => void;
}

export function SeriesSection({
  series,
  episodes,
  deletingId,
  creatingEpisode,
  dissolving,
  onDeleteProject,
  onCreateEpisode,
  onDissolve,
}: SeriesSectionProps) {
  // 集数升序展示（无编号的老数据排最后）
  const sorted = [...episodes].sort(
    (a, b) => (a.episodeNumber ?? Infinity) - (b.episodeNumber ?? Infinity)
  );
  // 与服务端同一套规则算下一集编号，按钮文案所见即所得
  const nextEp = nextEpisodeNumber(episodes.map((p) => p.episodeNumber));

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clapperboard size={18} className="text-primary" />
          <h2 className="text-foreground text-lg font-semibold">
            {series.title}
          </h2>
          <span className="text-muted-foreground text-sm">
            {series.genre ? `${series.genre} · ` : ""}共 {episodes.length} 集
          </span>
        </div>
        <button
          onClick={() => onDissolve(series)}
          disabled={dissolving}
          className="text-muted-foreground hover:text-destructive flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition"
          title="解散系列（各集变为独立项目，内容不删除）"
        >
          {dissolving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
          解散系列
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            deleting={deletingId === project.id}
            onDelete={onDeleteProject}
          />
        ))}

        {/* 新建一集：继承系列风格/画幅 + 上一集角色阵容 */}
        <button
          onClick={() => onCreateEpisode(series.id)}
          disabled={creatingEpisode}
          className="border-border bg-card/50 hover:border-primary flex aspect-video flex-col items-center justify-center rounded-xl border-2 border-dashed transition disabled:opacity-50"
        >
          {creatingEpisode ? (
            <Loader2
              size={32}
              className="text-muted-foreground mb-2 animate-spin"
            />
          ) : (
            <Plus size={32} className="text-muted-foreground mb-2" />
          )}
          <span className="text-muted-foreground text-sm">
            新建第 {nextEp} 集
          </span>
          <span className="text-muted-foreground/70 mt-1 px-4 text-center text-xs">
            自动继承世界观与角色阵容
          </span>
        </button>
      </div>
    </section>
  );
}
