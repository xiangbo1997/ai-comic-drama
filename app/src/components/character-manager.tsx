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

export function CharacterManager({ onSelect, selectedId }: CharacterManagerProps) {
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
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">角色库</h3>
        <button
          onClick={() => setShowForm(true)}
          className="p-1.5 hover:bg-gray-700 rounded-lg"
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
        <div className="text-center py-8 text-gray-500">
          <User size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无角色</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-2 text-blue-400 text-sm hover:underline"
          >
            创建第一个角色
          </button>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {characters?.map((character) => (
            <div
              key={character.id}
              onClick={() => onSelect?.(character)}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition ${
                selectedId === character.id
                  ? "bg-blue-600/20 ring-1 ring-blue-500"
                  : "hover:bg-gray-700"
              }`}
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden shrink-0">
                {character.referenceImages[0] ? (
                  <img
                    src={character.referenceImages[0]}
                    alt={character.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User size={20} className="text-gray-500" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{character.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {[character.gender, character.age].filter(Boolean).join(" · ") ||
                    "未设置"}
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
                  className="p-1.5 hover:bg-gray-600 rounded"
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
                  className="p-1.5 hover:bg-gray-600 rounded"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(character.id);
                  }}
                  className="p-1.5 hover:bg-red-600 rounded"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {editingId ? "编辑角色" : "创建角色"}
              </h3>
              <button onClick={resetForm} className="p-1 hover:bg-gray-700 rounded">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="角色名称"
                  className="w-full bg-gray-700 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm text-gray-400 mb-1">性别</label>
                  <select
                    value={formData.gender}
                    onChange={(e) =>
                      setFormData({ ...formData, gender: e.target.value })
                    }
                    className="w-full bg-gray-700 rounded-lg px-3 py-2"
                  >
                    <option value="">未设置</option>
                    <option value="male">男</option>
                    <option value="female">女</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-gray-400 mb-1">年龄</label>
                  <input
                    type="text"
                    value={formData.age}
                    onChange={(e) =>
                      setFormData({ ...formData, age: e.target.value })
                    }
                    placeholder="如: 25"
                    className="w-full bg-gray-700 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">外貌描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="描述角色的外貌特征，如：黑色长发，大眼睛，瓜子脸..."
                  rows={3}
                  className="w-full bg-gray-700 rounded-lg px-3 py-2 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={resetForm}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
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
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 size={18} className="animate-spin mx-auto" />
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
