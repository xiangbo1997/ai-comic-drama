"use client";

import { useState } from "react";
import { Trash2, Edit2, Loader2, X, Check } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "@/types";
import { CATEGORY_LABELS, createTag, updateTag, deleteTag } from "./constants";

interface TagManagerModalProps {
  tags: Tag[];
  tagsByCategory: Record<string, Tag[]>;
  onClose: () => void;
}

export function TagManagerModal({ tags, tagsByCategory, onClose }: TagManagerModalProps) {
  const queryClient = useQueryClient();
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
    mutationFn: ({ id, data }: { id: string; data: { name?: string; category?: string; color?: string } }) =>
      updateTag(id, data),
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold">管理标签</h2>
          <button onClick={handleClose} className="p-1 hover:bg-gray-700 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h3 className="text-sm font-medium mb-3">创建自定义标签</h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagFormData.name}
                  onChange={(e) => setTagFormData({ ...tagFormData, name: e.target.value })}
                  placeholder="标签名称"
                  className="flex-1 px-3 py-2 bg-gray-700 rounded-lg text-sm"
                />
                <select
                  value={tagFormData.category}
                  onChange={(e) => setTagFormData({ ...tagFormData, category: e.target.value })}
                  className="px-3 py-2 bg-gray-700 rounded-lg text-sm"
                >
                  <option value="style">风格</option>
                  <option value="gender">性别</option>
                  <option value="role">角色类型</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-sm text-gray-400">颜色：</label>
                <input
                  type="color"
                  value={tagFormData.color}
                  onChange={(e) => setTagFormData({ ...tagFormData, color: e.target.value })}
                  className="w-10 h-8 rounded cursor-pointer bg-transparent"
                />
                <div
                  className="px-3 py-1 rounded-full text-sm"
                  style={{ backgroundColor: tagFormData.color }}
                >
                  预览
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => createTagMutation.mutate(tagFormData)}
                  disabled={!tagFormData.name.trim() || createTagMutation.isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg text-sm flex items-center gap-1"
                >
                  {createTagMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  创建
                </button>
              </div>
              {createTagMutation.error && (
                <p className="text-red-400 text-xs">
                  {createTagMutation.error instanceof Error ? createTagMutation.error.message : "创建失败"}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {Object.entries(tagsByCategory).map(([category, categoryTags]) => (
              <div key={category}>
                <h4 className="text-xs text-gray-500 uppercase mb-2">
                  {CATEGORY_LABELS[category] || category}
                </h4>
                <div className="space-y-1">
                  {categoryTags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center gap-2 p-2 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition"
                    >
                      {editingTagId === tag.id ? (
                        <>
                          <input
                            type="color"
                            value={tagFormData.color}
                            onChange={(e) => setTagFormData({ ...tagFormData, color: e.target.value })}
                            className="w-8 h-6 rounded cursor-pointer bg-transparent"
                          />
                          <input
                            type="text"
                            value={tagFormData.name}
                            onChange={(e) => setTagFormData({ ...tagFormData, name: e.target.value })}
                            className="flex-1 px-2 py-1 bg-gray-700 rounded text-sm"
                          />
                          <select
                            value={tagFormData.category}
                            onChange={(e) => setTagFormData({ ...tagFormData, category: e.target.value })}
                            className="px-2 py-1 bg-gray-700 rounded text-sm"
                          >
                            <option value="style">风格</option>
                            <option value="gender">性别</option>
                            <option value="role">角色类型</option>
                            <option value="other">其他</option>
                          </select>
                          <button
                            onClick={() => updateTagMutation.mutate({ id: tag.id, data: tagFormData })}
                            disabled={updateTagMutation.isPending}
                            className="p-1 hover:bg-green-600 rounded"
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
                              setTagFormData({ name: "", category: "other", color: "#6B7280" });
                            }}
                            className="p-1 hover:bg-gray-600 rounded"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: tag.color || "#6B7280" }}
                          />
                          <span className="flex-1 text-sm">{tag.name}</span>
                          {tag.isSystem ? (
                            <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-700 rounded">
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
                                className="p-1 hover:bg-gray-600 rounded opacity-50 hover:opacity-100"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`确定删除标签「${tag.name}」吗？`)) {
                                    deleteTagMutation.mutate(tag.id);
                                  }
                                }}
                                disabled={deleteTagMutation.isPending}
                                className="p-1 hover:bg-red-600 rounded opacity-50 hover:opacity-100"
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

        <div className="p-4 border-t border-gray-700">
          <button
            onClick={handleClose}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
