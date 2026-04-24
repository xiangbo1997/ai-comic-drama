"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Edit2,
  Loader2,
  X,
  User,
  Wand2,
  Upload,
} from "lucide-react";
import type { Character } from "@/types";

interface CharacterManagerProps {
  onSelect?: (character: Character) => void;
  selectedId?: string;
}

async function fetchCharacters(): Promise<Character[]> {
  const res = await fetch("/api/characters");
  if (!res.ok) throw new Error("Failed to fetch characters");
  return res.json();
}

async function createCharacter(data: Partial<Character>) {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create character");
  return res.json();
}

async function updateCharacter(id: string, data: Partial<Character>) {
  const res = await fetch(`/api/characters/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update character");
  return res.json();
}

async function deleteCharacter(id: string) {
  const res = await fetch(`/api/characters/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete character");
  return res.json();
}

async function generateReferenceImage(id: string) {
  const res = await fetch(`/api/characters/${id}/generate-reference`, {
    method: "POST",
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to generate image");
  }
  return res.json();
}

export function CharacterManager({
  onSelect,
  selectedId,
}: CharacterManagerProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    gender: "",
    age: "",
    description: "",
  });

  const { data: characters, isLoading } = useQuery({
    queryKey: ["characters"],
    queryFn: fetchCharacters,
  });

  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Character> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const generateImageMutation = useMutation({
    mutationFn: generateReferenceImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: "", gender: "", age: "", description: "" });
  };

  const handleEdit = (character: Character) => {
    setEditingId(character.id);
    setFormData({
      name: character.name,
      gender: character.gender || "",
      age: character.age || "",
      description: character.description || "",
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) return;

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("确定要删除这个角色吗？")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="rounded-xl bg-gray-800 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">角色库</h3>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg p-1.5 hover:bg-gray-700"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Character List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : characters?.length === 0 ? (
        <div className="py-8 text-center text-gray-500">
          <User size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无角色</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-2 text-sm text-blue-400 hover:underline"
          >
            创建第一个角色
          </button>
        </div>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {characters?.map((character) => (
            <div
              key={character.id}
              onClick={() => onSelect?.(character)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${
                selectedId === character.id
                  ? "bg-blue-600/20 ring-1 ring-blue-500"
                  : "hover:bg-gray-700"
              }`}
            >
              {/* Avatar */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-700">
                {character.referenceImages[0] ? (
                  <img
                    src={character.referenceImages[0]}
                    alt={character.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User size={20} className="text-gray-500" />
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{character.name}</p>
                <p className="truncate text-xs text-gray-400">
                  {[character.gender, character.age]
                    .filter(Boolean)
                    .join(" · ") || "未设置"}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateImageMutation.mutate(character.id);
                  }}
                  disabled={generateImageMutation.isPending}
                  className="rounded p-1.5 hover:bg-gray-600"
                  title="生成参考图"
                >
                  {generateImageMutation.isPending &&
                  generateImageMutation.variables === character.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Wand2 size={14} />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(character);
                  }}
                  className="rounded p-1.5 hover:bg-gray-600"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(character.id);
                  }}
                  className="rounded p-1.5 hover:bg-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editingId ? "编辑角色" : "创建角色"}
              </h3>
              <button
                onClick={resetForm}
                className="rounded p-1 hover:bg-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="角色名称"
                  className="w-full rounded-lg bg-gray-700 px-3 py-2"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="mb-1 block text-sm text-gray-400">
                    性别
                  </label>
                  <select
                    value={formData.gender}
                    onChange={(e) =>
                      setFormData({ ...formData, gender: e.target.value })
                    }
                    className="w-full rounded-lg bg-gray-700 px-3 py-2"
                  >
                    <option value="">未设置</option>
                    <option value="male">男</option>
                    <option value="female">女</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-sm text-gray-400">
                    年龄
                  </label>
                  <input
                    type="text"
                    value={formData.age}
                    onChange={(e) =>
                      setFormData({ ...formData, age: e.target.value })
                    }
                    placeholder="如: 25"
                    className="w-full rounded-lg bg-gray-700 px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  外貌描述
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="描述角色的外貌特征，如：黑色长发，大眼睛，瓜子脸..."
                  rows={3}
                  className="w-full resize-none rounded-lg bg-gray-700 px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={resetForm}
                className="flex-1 rounded-lg bg-gray-700 py-2 hover:bg-gray-600"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={
                  !formData.name.trim() ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
                className="flex-1 rounded-lg bg-blue-600 py-2 hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 size={18} className="mx-auto animate-spin" />
                ) : editingId ? (
                  "保存"
                ) : (
                  "创建"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
