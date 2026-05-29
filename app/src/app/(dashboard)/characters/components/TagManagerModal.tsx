"use client";

import { useState } from "react";
import { Trash2, Edit2, Loader2, X, Check } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "@/types";
import { CATEGORY_LABELS, createTag, updateTag, deleteTag } from "./constants";
import { useToast } from "@/components/ui/toast";

interface TagManagerModalProps {
  tags: Tag[];
  tagsByCategory: Record<string, Tag[]>;
  onClose: () => void;
}

export function TagManagerModal({
  tagsByCategory,
  onClose,
}: TagManagerModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagFormData, setTagFormData] = useState({
    name: "",
    category: "other",
    color: "#6B7280",
  });

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      setTagFormData({ name: "", category: "other", color: "#6B7280" });
    },
  });

  const updateTagMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; category?: string; color?: string };
    }) => updateTag(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setEditingTagId(null);
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const handleClose = () => {
    setEditingTagId(null);
    setTagFormData({ name: "", category: "other", color: "#6B7280" });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl">
        <div className="border-border flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">管理标签</h2>
          <button
            onClick={handleClose}
            className="hover:bg-secondary rounded p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-secondary/50 mb-6 rounded-lg p-4">
            <h3 className="mb-3 text-sm font-medium">创建自定义标签</h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagFormData.name}
                  onChange={(e) =>
                    setTagFormData({ ...tagFormData, name: e.target.value })
                  }
                  placeholder="标签名称"
                  className="bg-secondary flex-1 rounded-lg px-3 py-2 text-sm"
                />
                <select
                  value={tagFormData.category}
                  onChange={(e) =>
                    setTagFormData({ ...tagFormData, category: e.target.value })
                  }
                  className="bg-secondary rounded-lg px-3 py-2 text-sm"
                >
                  <option value="style">风格</option>
                  <option value="gender">性别</option>
                  <option value="role">角色类型</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground text-sm">颜色：</label>
                <input
                  type="color"
                  value={tagFormData.color}
                  onChange={(e) =>
                    setTagFormData({ ...tagFormData, color: e.target.value })
                  }
                  className="h-8 w-10 cursor-pointer rounded bg-transparent"
                />
                <div
                  className="rounded-full px-3 py-1 text-sm"
                  style={{ backgroundColor: tagFormData.color }}
                >
                  预览
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => createTagMutation.mutate(tagFormData)}
                  disabled={
                    !tagFormData.name.trim() || createTagMutation.isPending
                  }
                  className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex items-center gap-1 rounded-lg px-4 py-2 text-sm"
                >
                  {createTagMutation.isPending && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  创建
                </button>
              </div>
              {createTagMutation.error && (
                <p className="text-xs text-red-400">
                  {createTagMutation.error instanceof Error
                    ? createTagMutation.error.message
                    : "创建失败"}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {Object.entries(tagsByCategory).map(([category, categoryTags]) => (
              <div key={category}>
                <h4 className="text-muted-foreground mb-2 text-xs uppercase">
                  {CATEGORY_LABELS[category] || category}
                </h4>
                <div className="space-y-1">
                  {categoryTags.map((tag) => (
                    <div
                      key={tag.id}
                      className="bg-secondary/30 hover:bg-secondary/50 flex items-center gap-2 rounded-lg p-2 transition"
                    >
                      {editingTagId === tag.id ? (
                        <>
                          <input
                            type="color"
                            value={tagFormData.color}
                            onChange={(e) =>
                              setTagFormData({
                                ...tagFormData,
                                color: e.target.value,
                              })
                            }
                            className="h-6 w-8 cursor-pointer rounded bg-transparent"
                          />
                          <input
                            type="text"
                            value={tagFormData.name}
                            onChange={(e) =>
                              setTagFormData({
                                ...tagFormData,
                                name: e.target.value,
                              })
                            }
                            className="bg-secondary flex-1 rounded px-2 py-1 text-sm"
                          />
                          <select
                            value={tagFormData.category}
                            onChange={(e) =>
                              setTagFormData({
                                ...tagFormData,
                                category: e.target.value,
                              })
                            }
                            className="bg-secondary rounded px-2 py-1 text-sm"
                          >
                            <option value="style">风格</option>
                            <option value="gender">性别</option>
                            <option value="role">角色类型</option>
                            <option value="other">其他</option>
                          </select>
                          <button
                            onClick={() =>
                              updateTagMutation.mutate({
                                id: tag.id,
                                data: tagFormData,
                              })
                            }
                            disabled={updateTagMutation.isPending}
                            className="rounded p-1 hover:bg-green-600"
                          >
                            {updateTagMutation.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setEditingTagId(null);
                              setTagFormData({
                                name: "",
                                category: "other",
                                color: "#6B7280",
                              });
                            }}
                            className="hover:bg-secondary/80 rounded p-1"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div
                            className="h-4 w-4 rounded-full"
                            style={{ backgroundColor: tag.color || "#6B7280" }}
                          />
                          <span className="flex-1 text-sm">{tag.name}</span>
                          {tag.isSystem ? (
                            <span className="bg-secondary text-muted-foreground rounded px-2 py-0.5 text-xs">
                              系统
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingTagId(tag.id);
                                  setTagFormData({
                                    name: tag.name,
                                    category: tag.category || "other",
                                    color: tag.color || "#6B7280",
                                  });
                                }}
                                className="hover:bg-secondary/80 rounded p-1 opacity-50 hover:opacity-100"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={async () => {
                                  const ok = await toast.confirm(
                                    `确定删除标签「${tag.name}」吗？`
                                  );
                                  if (ok) {
                                    deleteTagMutation.mutate(tag.id);
                                  }
                                }}
                                disabled={deleteTagMutation.isPending}
                                className="rounded p-1 opacity-50 hover:bg-red-600 hover:opacity-100"
                              >
                                {deleteTagMutation.isPending ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-border border-t p-4">
          <button
            onClick={handleClose}
            className="bg-secondary hover:bg-secondary/80 w-full rounded-lg py-2"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
