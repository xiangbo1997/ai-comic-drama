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
  generateDescriptionMutation: UseMutationResult<
    { description: string },
    Error,
    { name: string; gender: string; age: string }
  >;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-700 p-4">
          <h2 className="text-lg font-semibold">创建角色</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-700">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400">
              角色名称 *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                onFormDataChange({ ...formData, name: e.target.value })
              }
              className="w-full rounded-lg bg-gray-700 px-3 py-2"
              placeholder="如：林萧"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">性别</label>
              <select
                value={formData.gender}
                onChange={(e) =>
                  onFormDataChange({ ...formData, gender: e.target.value })
                }
                className="w-full rounded-lg bg-gray-700 px-3 py-2"
              >
                <option value="female">女</option>
                <option value="male">男</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">年龄</label>
              <input
                type="text"
                value={formData.age}
                onChange={(e) =>
                  onFormDataChange({ ...formData, age: e.target.value })
                }
                className="w-full rounded-lg bg-gray-700 px-3 py-2"
                placeholder="如：24"
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
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
                disabled={
                  !formData.name.trim() || generateDescriptionMutation.isPending
                }
                className="flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-600"
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
              onChange={(e) =>
                onFormDataChange({ ...formData, description: e.target.value })
              }
              className="w-full resize-none rounded-lg bg-gray-700 px-3 py-2"
              rows={3}
              placeholder="如：黑色长发，瓜子脸，大眼睛，身材纤细"
            />
            {generateDescriptionMutation.error && (
              <p className="mt-1 text-xs text-red-400">
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
              className="mb-2 flex items-center gap-1 text-sm text-blue-400 transition hover:text-blue-300"
            >
              {showAppearanceEditor ? "▾" : "▸"}{" "}
              结构化外貌（可选，提升角色一致性）
            </button>
            {showAppearanceEditor && (
              <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
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
            <label className="mb-1 block text-sm text-gray-400">声线</label>
            <select
              value={formData.voiceId}
              onChange={(e) =>
                onFormDataChange({ ...formData, voiceId: e.target.value })
              }
              className="w-full rounded-lg bg-gray-700 px-3 py-2"
            >
              <option value="">选择声线（可选）</option>
              {VOICE_PRESETS.filter((v) => v.gender === formData.gender).map(
                (voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                )
              )}
            </select>
          </div>
          {tags.length > 0 && (
            <div>
              <label className="mb-2 block text-sm text-gray-400">标签</label>
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
                      className={`rounded-full px-3 py-1 text-sm transition ${
                        isSelected
                          ? "ring-2 ring-offset-2 ring-offset-gray-800"
                          : "opacity-50 hover:opacity-100"
                      } `}
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
        <div className="flex gap-3 border-t border-gray-700 p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-gray-700 py-2 hover:bg-gray-600"
          >
            取消
          </button>
          <button
            onClick={onCreate}
            disabled={!formData.name.trim() || createPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 hover:bg-blue-700 disabled:bg-gray-600"
          >
            {createPending && <Loader2 size={18} className="animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
