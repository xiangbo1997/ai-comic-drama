"use client";

import Link from "next/link";
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
import type { ProjectDetail, Character } from "@/types";

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
    <div className="w-1/3 border-r border-gray-800 flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h2 className="font-semibold mb-2">输入文本</h2>
        <p className="text-sm text-gray-400">粘贴小说片段或故事大纲</p>
      </div>
      <div className="flex-1 p-4 overflow-hidden">
        <textarea
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={`在这里粘贴你的小说文本...

例如：
林萧匆匆走进公司大楼，今天是她入职的第一天。电梯门打开的瞬间，她与一个西装革履的男人撞了个满怀。

"对不起！"她慌忙道歉。

男人冷冷地看了她一眼，没有说话，径直走进了电梯。

林萧不知道的是，这个男人就是她即将面对的顶头上司——陆景琛。`}
          className="w-full h-full bg-gray-800 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>
      <div className="p-4 border-t border-gray-800 space-y-2">
        <button
          onClick={onParse}
          disabled={!inputText.trim() || isParsing || isWorkflowRunning}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition"
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
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition text-sm"
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
          <p className="text-red-400 text-sm mt-2 text-center">解析失败，请重试</p>
        )}
      </div>

      {/* 项目角色侧边栏 */}
      <div className="border-t border-gray-800">
        <button
          onClick={onToggleCharacterPanel}
          className="w-full px-4 py-2 flex items-center justify-between text-sm hover:bg-gray-800/50 transition"
        >
          <div className="flex items-center gap-2">
            <Users size={16} className="text-gray-400" />
            <span className="text-gray-300">项目角色</span>
            {project.characters.length > 0 && (
              <span className="text-xs text-gray-500">({project.characters.length})</span>
            )}
          </div>
          {showCharacterPanel ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronUp size={16} className="text-gray-400" />
          )}
        </button>

        {showCharacterPanel && (
          <div className="p-3 bg-gray-800/30">
            {project.characters.length > 0 ? (
              <div className="space-y-2">
                {project.characters.map(({ character }) => (
                  <div
                    key={character.id}
                    className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg hover:bg-gray-700/50 transition cursor-pointer"
                    title={character.description || character.name}
                  >
                    {character.referenceImages?.[0] ? (
                      <img
                        src={character.referenceImages[0]}
                        alt={character.name}
                        className="w-8 h-8 rounded-full object-cover ring-2 ring-gray-700"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                        <User size={14} className="text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{character.name}</div>
                      {character.description && (
                        <div className="text-xs text-gray-500 truncate">{character.description}</div>
                      )}
                    </div>
                    {character.referenceImages?.length > 0 && (
                      <div className="w-2 h-2 rounded-full bg-green-500" title="有参考图" />
                    )}
                  </div>
                ))}
                <button
                  onClick={onManageCharacters}
                  className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition"
                >
                  <Plus size={12} />
                  管理角色
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                <Users size={24} className="mx-auto mb-2 text-gray-600" />
                <p className="text-xs text-gray-500 mb-2">暂无关联角色</p>
                <button
                  onClick={onManageCharacters}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
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
