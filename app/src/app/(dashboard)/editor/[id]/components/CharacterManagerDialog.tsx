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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold">管理项目角色</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {allCharacters.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <Users size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无角色</p>
              <p className="text-sm mt-2">
                请先在{" "}
                <Link href="/characters" className="text-blue-400 hover:underline">角色管理</Link>{" "}
                页面创建角色
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 mb-3">
                选择要关联到此项目的角色，关联后可在分镜中使用角色参考图生成一致的图像。
              </p>
              {allCharacters.map((character) => (
                <label
                  key={character.id}
                  className="flex items-center gap-3 p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg cursor-pointer transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedCharacterIds.has(character.id)}
                    onChange={() => onToggleCharacter(character.id)}
                    className="w-5 h-5 rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500"
                  />
                  {character.referenceImages?.[0] ? (
                    <img src={character.referenceImages[0]} alt={character.name} className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-600 flex items-center justify-center">
                      <User size={20} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{character.name}</div>
                    {character.description && (
                      <div className="text-sm text-gray-400 truncate">{character.description}</div>
                    )}
                  </div>
                  {character.referenceImages && character.referenceImages.length > 0 && (
                    <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">有参考图</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-700 flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition">取消</button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
