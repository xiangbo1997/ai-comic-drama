"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ProjectListItem } from "@/types";

const statusMap = {
  DRAFT: { label: "草稿", color: "bg-gray-500" },
  PROCESSING: { label: "生成中", color: "bg-yellow-500" },
  COMPLETED: { label: "已完成", color: "bg-green-500" },
  FAILED: { label: "失败", color: "bg-red-500" },
};

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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
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
    },
  });

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("确定要删除这个项目吗？此操作不可恢复。")) {
      setDeletingId(id);
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">我的项目</h1>
          <p className="text-gray-400 mt-1">创建和管理你的漫剧项目</p>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded-lg transition"
        >
          {createMutation.isPending ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Plus size={20} />
          )}
          新建项目
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-20">
          <p className="text-red-400 mb-4">加载失败，请重试</p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["projects"] })}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
          >
            重新加载
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && projects?.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎬</div>
          <h2 className="text-xl font-semibold mb-2">还没有项目</h2>
          <p className="text-gray-400 mb-6">创建你的第一个漫剧项目吧</p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <Plus size={20} />
            新建项目
          </button>
        </div>
      )}

      {/* Projects Grid */}
      {!isLoading && !error && projects && projects.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/editor/${project.id}`}
              className="group bg-gray-800 rounded-xl overflow-hidden hover:ring-2 hover:ring-blue-500 transition relative"
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                {project.thumbnail ? (
                  <img
                    src={project.thumbnail}
                    alt={project.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-4xl">🎬</span>
                )}

                {/* Delete Button */}
                <button
                  onClick={(e) => handleDelete(e, project.id)}
                  disabled={deletingId === project.id}
                  className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-red-600 rounded-lg opacity-0 group-hover:opacity-100 transition"
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
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold truncate flex-1 mr-2">
                    {project.title}
                  </h3>
                  <span
                    className={`px-2 py-0.5 text-xs rounded shrink-0 ${
                      statusMap[project.status].color
                    }`}
                  >
                    {statusMap[project.status].label}
                  </span>
                </div>
                <div className="text-sm text-gray-400">
                  {project.scenesCount} 个分镜 ·{" "}
                  {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                </div>
              </div>
            </Link>
          ))}

          {/* New Project Card */}
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="bg-gray-800/50 border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center aspect-[4/3] hover:border-blue-500 transition disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 size={40} className="text-gray-500 mb-2 animate-spin" />
            ) : (
              <Plus size={40} className="text-gray-500 mb-2" />
            )}
            <span className="text-gray-500">创建新项目</span>
          </button>
        </div>
      )}
    </div>
  );
}
