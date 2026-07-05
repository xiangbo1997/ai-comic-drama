"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Play,
  Download,
  Settings,
  Clock,
  Music,
  Sparkles,
  Type,
  Stamp,
  Sticker,
  ArrowLeftRight,
  SlidersHorizontal,
} from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { CreditsDisplay } from "@/components/credits-display";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface EditorHeaderProps {
  title: string;
  editingTitle: boolean;
  showTimeline: boolean;
  showSettings: boolean;
  hasScenes: boolean;
  /** 至少一个分镜有图才允许导出——此前分镜存在但全无图时导出仍可点，
      用户点开才发现导不出东西（ux-editor P1-8） */
  canExport: boolean;
  onTitleChange: (title: string) => void;
  onTitleSave: (title: string) => void;
  onEditTitle: () => void;
  onToggleTimeline: () => void;
  onToggleSettings: () => void;
  onMusic: () => void;
  onPreview: () => void;
  onExport: () => void;
  // 成片装饰入口（此前唯一入口在时间轴，关掉时间轴即消失；聚合到 Header
  // 下拉，与时间轴解耦，让能力可发现、可召回，a5 审计 P0-1）
  onSubtitle: () => void;
  onWatermark: () => void;
  onSticker: () => void;
  onTransition: () => void;
  onEffect: () => void;
}

export function EditorHeader({
  title,
  editingTitle,
  showTimeline,
  hasScenes,
  canExport,
  onTitleChange,
  onTitleSave,
  onEditTitle,
  onToggleTimeline,
  onToggleSettings,
  onMusic,
  onPreview,
  onExport,
  onSubtitle,
  onWatermark,
  onSticker,
  onTransition,
  onEffect,
}: EditorHeaderProps) {
  return (
    <header className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-4">
        <Link
          href="/projects"
          className="hover:bg-card rounded-lg p-2"
          aria-label="返回项目列表"
        >
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
          <div className="flex items-center gap-2">
            <button
              onClick={onEditTitle}
              className="hover:bg-card rounded px-2 py-1 text-lg font-medium"
            >
              {title}
            </button>
            <span className="bg-secondary text-muted-foreground rounded px-2 py-0.5 text-xs">
              编辑中
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <CreditsDisplay />
        <button
          onClick={onToggleTimeline}
          className={`rounded-lg p-2 transition ${showTimeline ? "bg-primary hover:bg-primary/90" : "hover:bg-card"}`}
          title="时间轴"
          aria-label="切换时间轴"
          aria-pressed={showTimeline}
        >
          <Clock size={20} />
        </button>
        {/* 成片装饰工具组：字幕/水印/贴图/转场/滤镜/配乐六项统一入口，
            与时间轴解耦——关掉时间轴不再丢失这些功能（a5 P0-1）。时间轴内
            原有入口保留作可视化上下文触发，但不再是唯一入口。 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!hasScenes}
            className="hover:bg-card flex items-center gap-1.5 rounded-lg px-3 py-2 transition disabled:cursor-not-allowed disabled:opacity-50"
            title="成片装饰（字幕/水印/贴图/转场/滤镜/配乐）"
            aria-label="成片装饰"
          >
            <Sparkles size={18} />
            <span className="hidden text-sm sm:inline">装饰</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>成片装饰</DropdownMenuLabel>
            <DropdownMenuItem onClick={onSubtitle}>
              <Type size={15} />
              字幕样式
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onWatermark}>
              <Stamp size={15} />
              品牌水印
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSticker}>
              <Sticker size={15} />
              贴图
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTransition}>
              <ArrowLeftRight size={15} />
              转场
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEffect}>
              <SlidersHorizontal size={15} />
              滤镜 / 变速
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onMusic}>
              <Music size={15} />
              配乐 / 背景音乐
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={onToggleSettings}
          className="hover:bg-card rounded-lg p-2"
          title="设置"
          aria-label="设置"
        >
          <Settings size={20} />
        </button>
        <button
          onClick={onPreview}
          className="border-agent text-agent hover:bg-agent/10 flex items-center gap-2 rounded-lg border px-4 py-2 transition disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasScenes}
        >
          <Play size={18} />
          预览
        </button>
        <button
          onClick={onExport}
          disabled={!hasScenes || !canExport}
          title={
            !hasScenes
              ? "请先拆解分镜"
              : !canExport
                ? "至少为一个分镜生成图片后才能导出"
                : "导出成片"
          }
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
