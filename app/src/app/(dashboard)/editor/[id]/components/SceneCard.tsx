"use client";

/**
 * 单张分镜卡片（从 SceneList 拆出并 React.memo 包裹）。
 *
 * memo 契约（为什么这样拆能真正止血整列表重渲染）：
 * 1. `scene` 按引用比较可行：React Query 缓存补丁器（patchCache）在某个分镜
 *    变化时只为该分镜创建新对象，其余分镜对象引用保持不变。因此默认浅比较下，
 *    未变化的卡片 `scene` 引用相等 → 跳过重渲染；只有真正变化的那张会重渲染。
 * 2. 回调必须引用稳定：父组件的 expandedScenes/openMenuId/选中态等 state 一变，
 *    若把内联箭头函数传进来会每次生成新引用，击穿 memo。故所有回调在
 *    SceneListImpl 里用 useCallback 固定引用（React Query v5 的 mutation.mutate
 *    本身稳定，只依赖 mutate + mediaConfig.*.selected 即可）。
 * 3. 其余 props 全是原语（index/isSelected/isExpanded/isMenuOpen/viewMode），
 *    默认浅比较足以判等，无需自定义 propsAreEqual。
 */

import { memo, type ReactNode } from "react";
import Image from "next/image";
import {
  Image as ImageIcon,
  Video,
  Volume2,
  Loader2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  User,
  AlertCircle,
  RotateCw,
  MoreVertical,
  Copy,
  Plus,
  Trash2,
  Play,
} from "lucide-react";
import type { Scene, ProjectDetail } from "@/types";
import { SortableItem } from "./SortableItem";

interface SceneCardProps {
  scene: Scene;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  isMenuOpen: boolean;
  viewMode: "list" | "grid2" | "grid3";
  /** 项目角色（用于展开区角色选择 chips） */
  characters: ProjectDetail["characters"];
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onMenuToggle: (id: string | null) => void;
  onManageCharacters: () => void;
  onDuplicate: (id: string) => void;
  onInsert: (id: string) => void;
  onDelete: (id: string) => void;
  onGenerateImage: (scene: Scene) => void;
  onGenerateVideo: (scene: Scene) => void;
  onGenerateAudio: (scene: Scene) => void;
  /** 查看该分镜视频（弹窗播放）；有 videoUrl 时可点 */
  onViewVideo: (scene: Scene) => void;
  updateScene: (sceneId: string, data: Partial<Scene>) => void;
  /** 登记卡片 DOM，供选中时 scrollIntoView（稳定回调，避免内联闭包击穿 memo） */
  registerItemRef: (id: string, el: HTMLElement | null) => void;
}

function SceneCardImpl({
  scene,
  index,
  isSelected,
  isExpanded,
  isMenuOpen,
  characters,
  onSelect,
  onToggleExpand,
  onMenuToggle,
  onManageCharacters,
  onDuplicate,
  onInsert,
  onDelete,
  onGenerateImage,
  onGenerateVideo,
  onGenerateAudio,
  onViewVideo,
  updateScene,
  registerItemRef,
}: SceneCardProps) {
  return (
    <SortableItem id={scene.id}>
      {({ attributes, listeners, isDragging }) => (
        <div
          ref={(el) => registerItemRef(scene.id, el)}
          className={`bg-card relative cursor-pointer rounded-lg transition ${
            isDragging ? "shadow-lg" : ""
          } ${isSelected ? "ring-primary ring-2" : "hover:bg-secondary"}`}
          onClick={() => onSelect(scene.id)}
        >
          {/* Scene Header — 大缩略图在左(16:9, 叠序号/景别/时长/三状态) + 描述在右 */}
          <div className="flex items-start gap-3 p-3">
            <button
              type="button"
              className="text-muted-foreground mt-1 shrink-0 cursor-grab touch-none active:cursor-grabbing"
              title="拖拽调整顺序"
              aria-label="拖拽调整分镜顺序"
              onClick={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={16} />
            </button>
            {/* 大缩略图 16:9 */}
            <div className="bg-secondary relative aspect-video w-32 shrink-0 overflow-hidden rounded-md">
              {/* 三状态角标：生成中 / 完成 / 失败 */}
              <SceneStatusBadge
                status={scene.imageStatus}
                hasImage={!!scene.imageUrl}
                videoStatus={scene.videoStatus}
                audioStatus={scene.audioStatus}
              />
              {/* 左上角序号 */}
              <span className="bg-background/70 absolute top-1 left-1 z-10 rounded px-1.5 py-0.5 text-[10px] leading-none font-medium backdrop-blur-sm">
                #{index + 1}
              </span>
              {/* 左下角景别 + 时长 */}
              <div className="absolute bottom-1 left-1 z-10 flex items-center gap-1">
                <span className="bg-background/70 rounded px-1 py-0.5 text-[10px] leading-none backdrop-blur-sm">
                  {scene.shotType || "中景"}
                </span>
                <span className="bg-background/70 rounded px-1 py-0.5 text-[10px] leading-none backdrop-blur-sm">
                  {scene.duration}s
                </span>
              </div>
              {/* 图像内容 */}
              <div className="flex h-full w-full items-center justify-center">
                {scene.imageStatus === "PROCESSING" ? (
                  <div className="bg-secondary h-full w-full animate-pulse" />
                ) : scene.imageStatus === "FAILED" && !scene.imageUrl ? (
                  <AlertCircle size={22} className="text-destructive" />
                ) : scene.imageUrl ? (
                  <Thumb src={scene.imageUrl} alt="" />
                ) : (
                  <ImageIcon size={22} className="text-muted-foreground" />
                )}
              </div>
            </div>
            {/* 右侧描述 + 标签 chips */}
            <div className="min-w-0 flex-1">
              <p className="text-foreground line-clamp-3 text-sm">
                {scene.description}
              </p>
              {scene.emotion && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 text-[10px] leading-none">
                    #{scene.emotion}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Expanded Content */}
          {isExpanded && (
            <div className="border-border space-y-2 border-t px-3 pt-3 pb-3">
              <div className="flex items-start gap-2 text-sm">
                <User size={14} className="text-muted-foreground mt-1" />
                <span className="text-muted-foreground mt-0.5">角色:</span>
                {characters.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {characters.map(({ character }) => {
                      const isCharSelected =
                        scene.selectedCharacterIds?.includes(character.id);
                      return (
                        <button
                          key={character.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const currentIds = scene.selectedCharacterIds || [];
                            const newIds = isCharSelected
                              ? currentIds.filter(
                                  (id: string) => id !== character.id
                                )
                              : [...currentIds, character.id];
                            updateScene(scene.id, {
                              selectedCharacterIds: newIds,
                            });
                          }}
                          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
                            isCharSelected
                              ? "bg-agent text-agent-foreground"
                              : "bg-secondary text-foreground hover:bg-secondary/80"
                          }`}
                        >
                          {character.referenceImages?.[0] && (
                            <img
                              src={character.referenceImages[0]}
                              alt=""
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          )}
                          {character.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    请先
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onManageCharacters();
                      }}
                      className="text-primary mx-1 hover:underline"
                    >
                      添加项目角色
                    </button>
                  </span>
                )}
              </div>
              {scene.dialogue && (
                <div className="text-sm">
                  <span className="text-muted-foreground">对话: </span>
                  <span className="text-foreground">{scene.dialogue}</span>
                </div>
              )}
              {scene.narration && (
                <div className="text-sm">
                  <span className="text-muted-foreground">旁白: </span>
                  <span className="text-foreground">{scene.narration}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 px-3 pb-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(scene.id);
              }}
              className="hover:bg-secondary rounded p-1"
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {/* 三点菜单：复制 / 插入 / 删除 */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMenuToggle(isMenuOpen ? null : scene.id);
                }}
                className="hover:bg-secondary rounded p-1"
                title="更多操作"
              >
                <MoreVertical size={14} />
              </button>
              {isMenuOpen && (
                <>
                  {/* 点击外部关闭 */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMenuToggle(null);
                    }}
                  />
                  <div className="bg-card border-border absolute top-7 left-0 z-20 w-32 overflow-hidden rounded-lg border shadow-lg">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(scene.id);
                      }}
                      className="hover:bg-secondary flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                    >
                      <Copy size={13} />
                      复制分镜
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onInsert(scene.id);
                      }}
                      className="hover:bg-secondary flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                    >
                      <Plus size={13} />
                      下方插入
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(scene.id);
                      }}
                      className="text-destructive flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                      删除分镜
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="flex-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onGenerateImage(scene);
              }}
              disabled={scene.imageStatus === "PROCESSING"}
              className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
              title={
                scene.imageStatus === "FAILED"
                  ? "图片生成失败，点击重试"
                  : "生成图片"
              }
            >
              {scene.imageStatus === "PROCESSING" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : scene.imageStatus === "FAILED" ? (
                <RotateCw size={14} className="text-destructive" />
              ) : (
                <ImageIcon size={14} />
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onGenerateVideo(scene);
              }}
              disabled={!scene.imageUrl || scene.videoStatus === "PROCESSING"}
              className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
              title={
                !scene.imageUrl
                  ? "请先生成图片"
                  : scene.videoStatus === "FAILED"
                    ? "视频生成失败，点击重试"
                    : "生成视频"
              }
            >
              {scene.videoStatus === "PROCESSING" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : scene.videoStatus === "FAILED" ? (
                <RotateCw size={14} className="text-destructive" />
              ) : (
                <Video size={14} />
              )}
            </button>
            {/* 查看视频：该分镜已生成视频时可点，弹窗播放 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewVideo(scene);
              }}
              disabled={!scene.videoUrl}
              className="hover:bg-secondary rounded p-1.5 disabled:opacity-30"
              title={scene.videoUrl ? "查看视频" : "尚未生成视频"}
            >
              <Play
                size={14}
                className={scene.videoUrl ? "text-primary" : ""}
              />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onGenerateAudio(scene);
              }}
              disabled={
                (!scene.dialogue && !scene.narration) ||
                scene.audioStatus === "PROCESSING"
              }
              className="hover:bg-secondary rounded p-1.5 disabled:opacity-50"
              title={
                !scene.dialogue && !scene.narration
                  ? "没有对话或旁白"
                  : scene.audioStatus === "FAILED"
                    ? "配音生成失败，点击重试"
                    : "生成配音"
              }
            >
              {scene.audioStatus === "PROCESSING" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : scene.audioStatus === "FAILED" ? (
                <RotateCw size={14} className="text-destructive" />
              ) : (
                <Volume2 size={14} />
              )}
            </button>
          </div>
        </div>
      )}
    </SortableItem>
  );
}

// memo：默认浅比较即可（scene 按引用比较 + 回调稳定 + 其余原语，见文件顶部契约）。
export const SceneCard = memo(SceneCardImpl);

/**
 * 缩略图：本地同源 URL（以 "/" 开头）走 next/image（自动优化 + 尺寸约束），
 * 绝对 http(s) URL 回退到原生 <img>（避免需要在 next.config 白名单里穷举所有
 * 图像 provider 域名）。容器已是 relative aspect-video w-32 overflow-hidden。
 */
function Thumb({ src, alt }: { src: string; alt: string }) {
  if (src.startsWith("/")) {
    return (
      <Image src={src} alt={alt} fill sizes="128px" className="object-cover" />
    );
  }
  return <img src={src} alt={alt} className="h-full w-full object-cover" />;
}

/**
 * 分镜缩略图三状态角标（对标 Boords/AI Storyboard pipeline 的 Queued/Generating/Ready）。
 * 叠在缩略图右上角，克制小巧，不喧宾夺主。
 */
function SceneStatusBadge({
  status,
  hasImage,
  videoStatus,
  audioStatus,
}: {
  status?: string | null;
  hasImage: boolean;
  videoStatus?: string | null;
  audioStatus?: string | null;
}) {
  // 右上角主角标：图像状态。FAILED 优先于 hasImage 判断——否则"有旧图但本次
  // 生成失败"会被错误显示为"就绪"，误导用户以为图是最新成功结果。
  let mainBadge: ReactNode = null;
  if (status === "PROCESSING") {
    mainBadge = (
      <span className="bg-primary/90 text-primary-foreground flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-none">
        <span className="bg-primary-foreground inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
        生成中
      </span>
    );
  } else if (status === "FAILED" && hasImage) {
    // 有旧图但本次失败：琥珀（primary）"可重试"，与"无图失败"的红色区分。
    // 缩略图上的实心角标形态保留，但色相收敛到设计系统 token（a4 P1-5：
    // 移除色板外的 blue/purple/amber/green，统一 primary/agent/chart-2）。
    mainBadge = (
      <span className="bg-primary/90 text-primary-foreground rounded px-1 py-0.5 text-[10px] leading-none">
        失败·可重试
      </span>
    );
  } else if (status === "FAILED") {
    mainBadge = (
      <span className="bg-destructive/90 rounded px-1 py-0.5 text-[10px] leading-none text-white">
        失败
      </span>
    );
  } else if (hasImage) {
    mainBadge = (
      <span className="bg-chart-2/90 flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-none text-white">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
        就绪
      </span>
    );
  }

  // 右下角附属角标：视频/音频生成中（核心耗时操作，缩略图上给可见反馈，
  // 避免用户分不清"在生成还是卡死"）。视频=agent(青)、配音=chart-2(绿)，
  // 与设计系统生成态色映射一致（图=primary/视=agent/音=chart-2）。
  const subBadges: ReactNode[] = [];
  if (videoStatus === "PROCESSING") {
    subBadges.push(
      <span
        key="v"
        className="bg-agent/90 text-agent-foreground flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-none"
      >
        <span className="bg-agent-foreground inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
        视频中
      </span>
    );
  }
  if (audioStatus === "PROCESSING") {
    subBadges.push(
      <span
        key="a"
        className="bg-chart-2/90 flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-none text-white"
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        配音中
      </span>
    );
  }

  if (!mainBadge && subBadges.length === 0) return null;

  return (
    <>
      {mainBadge && (
        <span className="absolute top-1 right-1 z-10">{mainBadge}</span>
      )}
      {subBadges.length > 0 && (
        <span className="absolute right-1 bottom-1 z-10 flex flex-col items-end gap-0.5">
          {subBadges}
        </span>
      )}
    </>
  );
}
