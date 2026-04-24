"use client";

import Link from "next/link";
import { ArrowLeft, Play, Download, Settings, Clock } from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { CreditsDisplay } from "@/components/credits-display";

interface EditorHeaderProps {
  title: string;
  editingTitle: boolean;
  showTimeline: boolean;
  showSettings: boolean;
  hasScenes: boolean;
  onTitleChange: (title: string) => void;
  onTitleSave: (title: string) => void;
  onEditTitle: () => void;
  onToggleTimeline: () => void;
  onToggleSettings: () => void;
  onPreview: () => void;
  onExport: () => void;
}

export function EditorHeader({
  title,
  editingTitle,
  showTimeline,
  hasScenes,
  onTitleChange,
  onTitleSave,
  onEditTitle,
  onToggleTimeline,
  onToggleSettings,
  onPreview,
  onExport,
}: EditorHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
      <div className="flex items-center gap-4">
        <Link href="/projects" className="rounded-lg p-2 hover:bg-gray-800">
          <ArrowLeft size={20} />
        </Link>
        {editingTitle ? (
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={() => onTitleSave(title)}
            onKeyDown={(e) => e.key === "Enter" && onTitleSave(title)}
            autoFocus
            className="rounded bg-gray-800 px-2 py-1 text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        ) : (
          <button
            onClick={onEditTitle}
            className="rounded px-2 py-1 text-lg font-medium hover:bg-gray-800"
          >
            {title}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <CreditsDisplay />
        <button
          onClick={onToggleTimeline}
          className={`rounded-lg p-2 transition ${showTimeline ? "bg-blue-600 hover:bg-blue-700" : "hover:bg-gray-800"}`}
          title="时间轴"
        >
          <Clock size={20} />
        </button>
        <button
          onClick={onToggleSettings}
          className="rounded-lg p-2 hover:bg-gray-800"
        >
          <Settings size={20} />
        </button>
        <button
          onClick={onPreview}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-700"
          disabled={!hasScenes}
        >
          <Play size={18} />
          预览
        </button>
        <button
          onClick={onExport}
          disabled={!hasScenes}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-700"
        >
          <Download size={18} />
          导出
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
