"use client";

import Link from "next/link";
import { User, Users, Loader2, Check } from "lucide-react";
import type { Character } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b p-4 text-left">
          <DialogTitle>管理项目角色</DialogTitle>
          <DialogDescription className="sr-only">
            选择要关联到当前项目的角色
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {allCharacters.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              <Users size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无角色</p>
              <p className="mt-2 text-sm">
                请先在{" "}
                <Link
                  href="/characters"
                  className="text-primary hover:underline"
                >
                  角色管理
                </Link>{" "}
                页面创建角色
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground mb-3 text-sm">
                选择要关联到此项目的角色，关联后可在分镜中使用角色参考图生成一致的图像。
              </p>
              {allCharacters.map((character) => (
                <label
                  key={character.id}
                  className="bg-secondary/50 hover:bg-secondary flex cursor-pointer items-center gap-3 rounded-lg p-3 transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedCharacterIds.has(character.id)}
                    onChange={() => onToggleCharacter(character.id)}
                    className="border-border bg-secondary text-primary focus:ring-primary h-5 w-5 rounded"
                  />
                  {character.referenceImages?.[0] ? (
                    <img
                      src={character.referenceImages[0]}
                      alt={character.name}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="bg-secondary flex h-12 w-12 items-center justify-center rounded-lg">
                      <User size={20} className="text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{character.name}</div>
                    {character.description && (
                      <div className="text-muted-foreground truncate text-sm">
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
        <DialogFooter className="border-border shrink-0 flex-row gap-2 border-t p-4">
          <button
            onClick={onClose}
            className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg px-4 py-2 transition"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 transition"
          >
            {isSaving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={18} />
            )}
            保存
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
