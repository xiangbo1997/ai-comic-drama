"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ProjectListItem } from "@/types";
import { CardGridSkeleton, ErrorState } from "@/components/ui/query-state";
import { useToast } from "@/components/ui/toast";

const statusMap = {
  DRAFT: { label: "草稿", color: "bg-muted text-muted-foreground" },
  PROCESSING: { label: "生成中", color: "bg-primary/20 text-primary" },
  COMPLETED: { label: "已完成", color: "bg-primary text-primary-foreground" },
  FAILED: { label: "失败", color: "bg-destructive/20 text-destructive" },
};

/** 管线单步进度点：total=0（该步无需做，如无台词的配音）显示"—" */
function ProgressDot({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  const complete = total > 0 && done >= total;
  const dotColor =
    total === 0
      ? "bg-muted-foreground/30"
      : complete
        ? "bg-chart-2"
        : done > 0
          ? "bg-primary"
          : "bg-muted-foreground/30";
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label} {total === 0 ? "—" : `${done}/${total}`}
    </span>
  );
}

async function fetchProjects(): Promise<ProjectListItem[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to fetch projects");
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

async function deleteProject(id: string) {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete project");
  return res.json();
}

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/editor/${project.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeletingId(null);
      toast.success("项目已删除");
    },
    onError: () => {
      setDeletingId(null);
      toast.error("删除失败，请重试");
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

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">我的项目</h1>
          <p className="text-muted-foreground mt-1">创建和管理你的漫剧项目</p>
        </div>
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
      {!isLoading && !error && projects?.length === 0 && (
        <div className="py-20 text-center">
          <div className="mb-4 text-6xl">🎬</div>
          <h2 className="text-foreground mb-2 text-xl font-semibold">
            还没有项目
          </h2>
          <p className="text-muted-foreground mb-6">创建你的第一个漫剧项目吧</p>
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

      {/* Projects Grid */}
      {!isLoading && !error && projects && projects.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/editor/${project.id}`}
              className="group border-border bg-card hover:ring-primary relative overflow-hidden rounded-xl border transition hover:ring-2"
            >
              {/* Thumbnail：同源 URL（本地盘 /uploads）走 next/image 自动压缩
                  缩略图尺寸；外链（R2 等未配置 remotePatterns）回退原生 img */}
              <div className="bg-secondary relative flex aspect-video items-center justify-center">
                {project.thumbnail ? (
                  project.thumbnail.startsWith("/") ? (
                    <Image
                      src={project.thumbnail}
                      alt={project.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 25vw"
                      className="object-cover"
                    />
                  ) : (
                    <img
                      src={project.thumbnail}
                      alt={project.title}
                      className="h-full w-full object-cover"
                    />
                  )
                ) : (
                  <span className="text-4xl opacity-60">🎬</span>
                )}

                {/* Delete Button */}
                <button
                  onClick={(e) => handleDelete(e, project)}
                  disabled={deletingId === project.id}
                  aria-label={`删除项目 ${project.title}`}
                  className="hover:bg-destructive text-foreground absolute top-2 right-2 rounded-lg bg-black/50 p-2 opacity-0 transition group-hover:opacity-100"
                >
                  {deletingId === project.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-foreground mr-2 flex-1 truncate font-semibold">
                    {project.title}
                  </h3>
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs ${
                      statusMap[project.status].color
                    }`}
                  >
                    {/* 生成中加旋转指示：静态色块看不出"后台在跑"，
                        且纯色差对色觉障碍不友好（ux-onboarding P2-10） */}
                    {project.status === "PROCESSING" && (
                      <Loader2 size={10} className="animate-spin" />
                    )}
                    {statusMap[project.status].label}
                  </span>
                </div>
                <div className="text-muted-foreground text-sm">
                  {project.scenesCount} 个分镜 ·{" "}
                  {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                </div>
                {/* 管线进度点：一眼看出项目卡在哪步（图→视→配音），
                    不用逐个点进编辑器看（a5 P1-6）。绿=全完成，琥珀=部分。 */}
                {project.scenesCount > 0 && (
                  <div className="text-muted-foreground mt-2 flex items-center gap-3 text-xs">
                    <ProgressDot
                      label="图"
                      done={project.imageCount ?? 0}
                      total={project.scenesCount}
                    />
                    <ProgressDot
                      label="视"
                      done={project.videoCount ?? 0}
                      total={project.scenesCount}
                    />
                    <ProgressDot
                      label="配"
                      done={project.audioCount ?? 0}
                      total={project.speakableCount ?? 0}
                    />
                  </div>
                )}
              </div>
            </Link>
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
      )}
    </div>
  );
}
