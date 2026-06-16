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
    <header className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-4">
        <Link href="/projects" className="hover:bg-card rounded-lg p-2">
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
            className="bg-card focus:ring-primary rounded px-2 py-1 text-lg font-medium focus:ring-2 focus:outline-none"
          />
        ) : (
          <button
            onClick={onEditTitle}
            className="hover:bg-card rounded px-2 py-1 text-lg font-medium"
          >
            {title}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <CreditsDisplay />
        <button
          onClick={onToggleTimeline}
          className={`rounded-lg p-2 transition ${showTimeline ? "bg-primary hover:bg-primary/90" : "hover:bg-card"}`}
          title="时间轴"
        >
          <Clock size={20} />
        </button>
        <button
          onClick={onToggleSettings}
          className="hover:bg-card rounded-lg p-2"
        >
          <Settings size={20} />
        </button>
        <button
          onClick={onPreview}
          className="border-border text-foreground hover:bg-secondary flex items-center gap-2 rounded-lg border px-4 py-2 transition disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasScenes}
        >
          <Play size={18} />
          预览
        </button>
        <button
          onClick={onExport}
          disabled={!hasScenes}
          className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex items-center gap-2 rounded-lg px-4 py-2 disabled:cursor-not-allowed"
        >
          <Download size={18} />
          导出
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
