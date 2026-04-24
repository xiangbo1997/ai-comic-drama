"use client";

import { Loader2, Wand2, X } from "lucide-react";
import type { Tag } from "@/types";
import {
  AppearanceEditor,
  type AppearanceFormData,
} from "@/components/appearance-editor";
import { VOICE_PRESETS, type CharacterFormData } from "./constants";
import type { UseMutationResult } from "@tanstack/react-query";

interface CreateCharacterModalProps {
  formData: CharacterFormData;
  onFormDataChange: (data: CharacterFormData) => void;
  showAppearanceEditor: boolean;
  onToggleAppearanceEditor: () => void;
  tags: Tag[];
  onClose: () => void;
  onCreate: () => void;
  createPending: boolean;
  generateDescriptionMutation: UseMutationResult<{ description: string }, Error, { name: string; gender: string; age: string }>;
}

export function CreateCharacterModal({
  formData,
  onFormDataChange,
  showAppearanceEditor,
  onToggleAppearanceEditor,
  tags,
  onClose,
  onCreate,
  createPending,
  generateDescriptionMutation,
}: CreateCharacterModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold">创建角色</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">角色名称 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onFormDataChange({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg"
              placeholder="如：林萧"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">性别</label>
              <select
                value={formData.gender}
                onChange={(e) => onFormDataChange({ ...formData, gender: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded-lg"
              >
                <option value="female">女</option>
                <option value="male">男</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">年龄</label>
              <input
                type="text"
                value={formData.age}
                onChange={(e) => onFormDataChange({ ...formData, age: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded-lg"
                placeholder="如：24"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-400">外貌描述</label>
              <button
                type="button"
                onClick={() =>
                  generateDescriptionMutation.mutate({
                    name: formData.name,
                    gender: formData.gender,
                    age: formData.age,
                  })
                }
                disabled={!formData.name.trim() || generateDescriptionMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded transition"
                title="根据名称、性别、年龄自动生成外貌描述"
              >
                {generateDescriptionMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Wand2 size={12} />
                )}
                AI 生成
              </button>
            </div>
            <textarea
              value={formData.description}
              onChange={(e) => onFormDataChange({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg resize-none"
              rows={3}
              placeholder="如：黑色长发，瓜子脸，大眼睛，身材纤细"
            />
            {generateDescriptionMutation.error && (
              <p className="text-red-400 text-xs mt-1">
                {generateDescriptionMutation.error instanceof Error
                  ? generateDescriptionMutation.error.message
                  : "生成失败"}
              </p>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={onToggleAppearanceEditor}
              className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition mb-2"
            >
              {showAppearanceEditor ? "▾" : "▸"} 结构化外貌（可选，提升角色一致性）
            </button>
            {showAppearanceEditor && (
              <div className="p-3 bg-gray-800 rounded-lg border border-gray-700">
                <AppearanceEditor
                  value={formData.appearance}
                  onChange={(appearance: AppearanceFormData) =>
                    onFormDataChange({ ...formData, appearance })
                  }
                  compact
                />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">声线</label>
            <select
              value={formData.voiceId}
              onChange={(e) => onFormDataChange({ ...formData, voiceId: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg"
            >
              <option value="">选择声线（可选）</option>
              {VOICE_PRESETS.filter((v) => v.gender === formData.gender).map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
          {tags.length > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">标签</label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const isSelected = formData.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        onFormDataChange({
                          ...formData,
                          tagIds: isSelected
                            ? formData.tagIds.filter((id) => id !== tag.id)
                            : [...formData.tagIds, tag.id],
                        });
                      }}
                      className={`
                        px-3 py-1 rounded-full text-sm transition
                        ${isSelected
                          ? "ring-2 ring-offset-2 ring-offset-gray-800"
                          : "opacity-50 hover:opacity-100"
                        }
                      `}
                      style={{ backgroundColor: tag.color || "#6B7280" }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={onCreate}
            disabled={!formData.name.trim() || createPending}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg flex items-center justify-center gap-2"
          >
            {createPending && <Loader2 size={18} className="animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
