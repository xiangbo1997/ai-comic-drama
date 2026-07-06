"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Clapperboard } from "lucide-react";
import { useState } from "react";
import type { ProjectListItem, SeriesSummary } from "@/types";
import { CardGridSkeleton, ErrorState } from "@/components/ui/query-state";
import { useToast } from "@/components/ui/toast";
import { ProjectCard } from "./components/ProjectCard";
import { SeriesSection } from "./components/SeriesSection";
import { CreateSeriesDialog } from "./components/CreateSeriesDialog";

async function fetchProjects(): Promise<ProjectListItem[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to fetch projects");
  }
  return res.json();
}

async function fetchSeries(): Promise<SeriesSummary[]> {
  const res = await fetch("/api/series");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to fetch series");
  }
  return res.json();
}

async function createProject() {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "未命名项目" }),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return res.json();
}

async function createEpisode(seriesId: string) {
  const res = await fetch(`/api/series/${seriesId}/episodes`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to create episode");
  return res.json();
}

async function deleteProject(id: string) {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete project");
  return res.json();
}

async function dissolveSeries(id: string) {
  const res = await fetch(`/api/series/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to dissolve series");
  return res.json();
}

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreateSeries, setShowCreateSeries] = useState(false);
  const [creatingEpisodeSeriesId, setCreatingEpisodeSeriesId] = useState<
    string | null
  >(null);
  const [dissolvingSeriesId, setDissolvingSeriesId] = useState<string | null>(
    null
  );

  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    // 有项目在生成中时轻量轮询：此前列表页不自动刷新，"生成中"看起来
    // 与已完成一样静止（ux-onboarding P2-10）
    refetchInterval: (query) =>
      query.state.data?.some((p) => p.status === "PROCESSING") ? 8000 : false,
  });

  const { data: seriesList } = useQuery({
    queryKey: ["series"],
    queryFn: fetchSeries,
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/editor/${project.id}`);
    },
  });

  const createEpisodeMutation = useMutation({
    mutationFn: createEpisode,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["series"] });
      setCreatingEpisodeSeriesId(null);
      router.push(`/editor/${project.id}`);
    },
    onError: () => {
      setCreatingEpisodeSeriesId(null);
      toast.error("新建一集失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["series"] });
      setDeletingId(null);
      toast.success("项目已删除");
    },
    onError: () => {
      setDeletingId(null);
      toast.error("删除失败，请重试");
    },
  });

  const dissolveMutation = useMutation({
    mutationFn: dissolveSeries,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["series"] });
      setDissolvingSeriesId(null);
      toast.success("系列已解散，各集已变为独立项目");
    },
    onError: () => {
      setDissolvingSeriesId(null);
      toast.error("解散失败，请重试");
    },
  });

  // 删除确认带上项目名 + 级联后果：项目下已生成的媒体资产会一并销毁，
  // 此前「此操作不可恢复」未说清用户花积分生成的作品也会蒸发（ux P1）
  const handleDelete = async (
    e: React.MouseEvent,
    project: ProjectListItem
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await toast.confirm(
      `确定删除「${project.title}」吗？\n项目下的 ${project.scenesCount} 个分镜及已生成的全部图片、视频、配音将一并永久删除，无法恢复。`
    );
    if (ok) {
      setDeletingId(project.id);
      deleteMutation.mutate(project.id);
    }
  };

  const handleCreateEpisode = (seriesId: string) => {
    setCreatingEpisodeSeriesId(seriesId);
    createEpisodeMutation.mutate(seriesId);
  };

  const handleDissolve = async (series: SeriesSummary) => {
    const ok = await toast.confirm(
      `确定解散系列「${series.title}」吗？\n各集会变为独立项目，分镜与已生成的内容不会删除。`
    );
    if (ok) {
      setDissolvingSeriesId(series.id);
      dissolveMutation.mutate(series.id);
    }
  };

  // 按系列分组：seriesId → 该系列的集；无 seriesId 的为独立项目
  const episodesBySeries = new Map<string, ProjectListItem[]>();
  const standaloneProjects: ProjectListItem[] = [];
  for (const p of projects ?? []) {
    if (p.seriesId) {
      episodesBySeries.set(p.seriesId, [
        ...(episodesBySeries.get(p.seriesId) ?? []),
        p,
      ]);
    } else {
      standaloneProjects.push(p);
    }
  }
  const hasSeries = (seriesList?.length ?? 0) > 0;
  const isEmpty = !isLoading && !error && projects?.length === 0 && !hasSeries;

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">我的项目</h1>
          <p className="text-muted-foreground mt-1">创建和管理你的漫剧项目</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateSeries(true)}
            className="border-primary/50 text-primary hover:bg-primary/10 flex items-center gap-2 rounded-lg border px-4 py-2 font-medium transition"
          >
            <Clapperboard size={18} />
            新建系列
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Plus size={20} />
            )}
            新建项目
          </button>
        </div>
      </div>

      {/* Loading State：骨架卡片替代孤零转圈（ux-onboarding P1-5） */}
      {isLoading && <CardGridSkeleton count={4} />}

      {/* Error State */}
      {error && (
        <ErrorState
          onRetry={() =>
            queryClient.invalidateQueries({ queryKey: ["projects"] })
          }
        />
      )}

      {/* Empty State */}
      {isEmpty && (
        <div className="py-20 text-center">
          <div className="mb-4 text-6xl">🎬</div>
          <h2 className="text-foreground mb-2 text-xl font-semibold">
            还没有项目
          </h2>
          <p className="text-muted-foreground mb-6">
            创建你的第一个漫剧项目吧；要拍多集连载，可以直接「新建系列」
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-medium transition"
          >
            <Plus size={20} />
            新建项目
          </button>

          {/* 首跑三步指引：空态是首跑教育的黄金位置。生成依赖用户自配
              API Key，把这一前提在撞墙前讲清（ux-onboarding P1-6） */}
          <div className="mx-auto mt-10 max-w-md text-left">
            <p className="text-foreground mb-4 text-center text-sm font-medium">
              三步开始创作
            </p>
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="bg-primary/20 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                  1
                </span>
                <span className="text-muted-foreground text-sm">
                  在{" "}
                  <Link
                    href="/settings/ai-models"
                    className="text-primary hover:underline"
                  >
                    设置 › AI 模型配置
                  </Link>{" "}
                  中填入你的 API Key（如
                  DeepSeek），生成能力依赖你自己的模型账号
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="bg-primary/20 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                  2
                </span>
                <span className="text-muted-foreground text-sm">
                  新建项目，粘贴小说片段或故事大纲
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="bg-primary/20 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                  3
                </span>
                <span className="text-muted-foreground text-sm">
                  一键拆解分镜，逐步生成图片、视频与配音，最后导出成片
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* 系列分组（每个系列一个区块，含"新建一集"入口） */}
      {!isLoading &&
        !error &&
        seriesList?.map((series) => (
          <SeriesSection
            key={series.id}
            series={series}
            episodes={episodesBySeries.get(series.id) ?? []}
            deletingId={deletingId}
            creatingEpisode={creatingEpisodeSeriesId === series.id}
            dissolving={dissolvingSeriesId === series.id}
            onDeleteProject={handleDelete}
            onCreateEpisode={handleCreateEpisode}
            onDissolve={handleDissolve}
          />
        ))}

      {/* 独立项目网格 */}
      {!isLoading && !error && standaloneProjects.length > 0 && (
        <section>
          {hasSeries && (
            <h2 className="text-foreground mb-4 text-lg font-semibold">
              独立项目
            </h2>
          )}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {standaloneProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                deleting={deletingId === project.id}
                onDelete={handleDelete}
              />
            ))}

            {/* New Project Card */}
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="border-border bg-card/50 hover:border-primary flex aspect-video flex-col items-center justify-center rounded-xl border-2 border-dashed transition disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <Loader2
                  size={40}
                  className="text-muted-foreground mb-2 animate-spin"
                />
              ) : (
                <Plus size={40} className="text-muted-foreground mb-2" />
              )}
              <span className="text-muted-foreground">创建新项目</span>
            </button>
          </div>
        </section>
      )}

      {showCreateSeries && (
        <CreateSeriesDialog
          standaloneProjects={standaloneProjects}
          onClose={() => setShowCreateSeries(false)}
          onCreated={() => setShowCreateSeries(false)}
        />
      )}
    </div>
  );
}
