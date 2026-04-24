"use client";

import Link from "next/link";
import { User, Users, Loader2, X, Check } from "lucide-react";
import type { Character } from "@/types";

interface CharacterManagerDialogProps {
  isOpen: boolean;
  allCharacters: Character[];
  selectedCharacterIds: Set<string>;
  isSaving: boolean;
  onToggleCharacter: (id: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function CharacterManagerDialog({
  isOpen,
  allCharacters,
  selectedCharacterIds,
  isSaving,
  onToggleCharacter,
  onSave,
  onClose,
}: CharacterManagerDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-700 p-4">
          <h3 className="text-lg font-semibold">管理项目角色</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-700">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {allCharacters.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              <Users size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无角色</p>
              <p className="mt-2 text-sm">
                请先在{" "}
                <Link
                  href="/characters"
                  className="text-blue-400 hover:underline"
                >
                  角色管理
                </Link>{" "}
                页面创建角色
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="mb-3 text-sm text-gray-400">
                选择要关联到此项目的角色，关联后可在分镜中使用角色参考图生成一致的图像。
              </p>
              {allCharacters.map((character) => (
                <label
                  key={character.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-700/50 p-3 transition hover:bg-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedCharacterIds.has(character.id)}
                    onChange={() => onToggleCharacter(character.id)}
                    className="h-5 w-5 rounded border-gray-500 bg-gray-600 text-blue-500 focus:ring-blue-500"
                  />
                  {character.referenceImages?.[0] ? (
                    <img
                      src={character.referenceImages[0]}
                      alt={character.name}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-600">
                      <User size={20} className="text-gray-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{character.name}</div>
                    {character.description && (
                      <div className="truncate text-sm text-gray-400">
                        {character.description}
                      </div>
                    )}
                  </div>
                  {character.referenceImages &&
                    character.referenceImages.length > 0 && (
                      <span className="rounded bg-green-400/10 px-2 py-1 text-xs text-green-400">
                        有参考图
                      </span>
                    )}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-gray-700 p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-gray-700 px-4 py-2 transition hover:bg-gray-600"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 transition hover:bg-blue-700 disabled:bg-gray-600"
          >
            {isSaving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={18} />
            )}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
