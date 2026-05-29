"use client";

import {
  Wand2,
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
  User,
  Users,
  Zap,
} from "lucide-react";
import type { ProjectDetail } from "@/types";

interface ScriptPanelProps {
  inputText: string;
  onInputChange: (text: string) => void;
  onParse: () => void;
  isParsing: boolean;
  parseError: Error | null;
  project: ProjectDetail;
  showCharacterPanel: boolean;
  onToggleCharacterPanel: () => void;
  onManageCharacters: () => void;
  /** Agent 全自动模式 */
  onStartWorkflow?: () => void;
  isWorkflowRunning?: boolean;
}

export function ScriptPanel({
  inputText,
  onInputChange,
  onParse,
  isParsing,
  parseError,
  project,
  showCharacterPanel,
  onToggleCharacterPanel,
  onManageCharacters,
  onStartWorkflow,
  isWorkflowRunning,
}: ScriptPanelProps) {
  return (
    <div className="border-border flex w-1/3 flex-col border-r">
      <div className="border-border border-b p-4">
        <h2 className="mb-2 font-semibold">输入文本</h2>
        <p className="text-muted-foreground text-sm">粘贴小说片段或故事大纲</p>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        <textarea
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={`在这里粘贴你的小说文本...

例如：
林萧匆匆走进公司大楼，今天是她入职的第一天。电梯门打开的瞬间，她与一个西装革履的男人撞了个满怀。

"对不起！"她慌忙道歉。

男人冷冷地看了她一眼，没有说话，径直走进了电梯。

林萧不知道的是，这个男人就是她即将面对的顶头上司——陆景琛。`}
          className="bg-card focus:ring-primary h-full w-full resize-none rounded-lg p-4 text-sm focus:ring-2 focus:outline-none"
        />
      </div>
      <div className="border-border space-y-2 border-t p-4">
        <button
          onClick={onParse}
          disabled={!inputText.trim() || isParsing || isWorkflowRunning}
          className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 transition disabled:cursor-not-allowed"
        >
          {isParsing ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Wand2 size={20} />
          )}
          {isParsing ? "解析中..." : "智能拆解分镜"}
        </button>
        {onStartWorkflow && (
          <button
            onClick={onStartWorkflow}
            disabled={!inputText.trim() || isParsing || isWorkflowRunning}
            className="disabled:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm transition hover:bg-purple-700 disabled:cursor-not-allowed"
          >
            {isWorkflowRunning ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Zap size={18} />
            )}
            {isWorkflowRunning ? "Agent 管线运行中..." : "Agent 全自动生成"}
          </button>
        )}
        {parseError && (
          <p className="mt-2 text-center text-sm text-red-400">
            解析失败，请重试
          </p>
        )}
      </div>

      {/* 项目角色侧边栏 */}
      <div className="border-border border-t">
        <button
          onClick={onToggleCharacterPanel}
          className="hover:bg-card/50 flex w-full items-center justify-between px-4 py-2 text-sm transition"
        >
          <div className="flex items-center gap-2">
            <Users size={16} className="text-muted-foreground" />
            <span className="text-foreground">项目角色</span>
            {project.characters.length > 0 && (
              <span className="text-muted-foreground text-xs">
                ({project.characters.length})
              </span>
            )}
          </div>
          {showCharacterPanel ? (
            <ChevronDown size={16} className="text-muted-foreground" />
          ) : (
            <ChevronUp size={16} className="text-muted-foreground" />
          )}
        </button>

        {showCharacterPanel && (
          <div className="bg-card/30 p-3">
            {project.characters.length > 0 ? (
              <div className="space-y-2">
                {project.characters.map(({ character }) => (
                  <div
                    key={character.id}
                    className="bg-card/50 hover:bg-secondary/50 flex cursor-pointer items-center gap-2 rounded-lg p-2 transition"
                    title={character.description || character.name}
                  >
                    {character.referenceImages?.[0] ? (
                      <img
                        src={character.referenceImages[0]}
                        alt={character.name}
                        className="ring-border h-8 w-8 rounded-full object-cover ring-2"
                      />
                    ) : (
                      <div className="bg-secondary flex h-8 w-8 items-center justify-center rounded-full">
                        <User size={14} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {character.name}
                      </div>
                      {character.description && (
                        <div className="text-muted-foreground truncate text-xs">
                          {character.description}
                        </div>
                      )}
                    </div>
                    {character.referenceImages?.length > 0 && (
                      <div
                        className="h-2 w-2 rounded-full bg-green-500"
                        title="有参考图"
                      />
                    )}
                  </div>
                ))}
                <button
                  onClick={onManageCharacters}
                  className="text-muted-foreground hover:bg-secondary/50 hover:text-foreground flex w-full items-center justify-center gap-1 rounded px-2 py-1.5 text-xs transition"
                >
                  <Plus size={12} />
                  管理角色
                </button>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Users
                  size={24}
                  className="text-muted-foreground mx-auto mb-2"
                />
                <p className="text-muted-foreground mb-2 text-xs">
                  暂无关联角色
                </p>
                <button
                  onClick={onManageCharacters}
                  className="text-primary hover:text-primary/80 text-xs transition"
                >
                  + 添加角色
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
