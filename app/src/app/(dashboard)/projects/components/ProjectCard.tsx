"use client";

/**
 * ProjectCard — 项目列表卡片（从 page.tsx 抽出）
 *
 * 系列分组与独立项目网格共用；episodeNumber 存在时在缩略图左上角
 * 显示「第N集」徽标。删除按钮 stopPropagation 避免触发卡片跳转。
 */

import Link from "next/link";
import Image from "next/image";
import { Trash2, Loader2 } from "lucide-react";
import type { ProjectListItem } from "@/types";

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

export interface ProjectCardProps {
  project: ProjectListItem;
  deleting: boolean;
  onDelete: (e: React.MouseEvent, project: ProjectListItem) => void;
}

export function ProjectCard({ project, deleting, onDelete }: ProjectCardProps) {
  return (
    <Link
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

        {/* 集数徽标（系列内的集才有） */}
        {project.episodeNumber != null && (
          <span className="bg-primary text-primary-foreground absolute top-2 left-2 rounded px-2 py-0.5 text-xs font-medium">
            第{project.episodeNumber}集
          </span>
        )}

        {/* Delete Button */}
        <button
          onClick={(e) => onDelete(e, project)}
          disabled={deleting}
          aria-label={`删除项目 ${project.title}`}
          className="hover:bg-destructive text-foreground absolute top-2 right-2 rounded-lg bg-black/50 p-2 opacity-0 transition group-hover:opacity-100"
        >
          {deleting ? (
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
  );
}
