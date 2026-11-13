"use client";

import type { ReactNode } from "react";

export type EditorPane = "script" | "scenes" | "edit";

const PANES = [
  { key: "script", label: "创作", region: "创作工作区" },
  { key: "scenes", label: "分镜", region: "分镜工作区" },
  { key: "edit", label: "编辑", region: "编辑工作区" },
] as const;

interface EditorWorkspaceProps {
  activePane: EditorPane;
  onPaneChange: (pane: EditorPane) => void;
  script: ReactNode;
  scenes: ReactNode;
  editor: ReactNode;
}

/** 小屏按工作区切换；只改变可见性，保持输入草稿、请求和编辑器状态常挂载。 */
export function EditorWorkspace({
  activePane,
  onPaneChange,
  script,
  scenes,
  editor,
}: EditorWorkspaceProps) {
  const content = { script, scenes, edit: editor };
  return (
    <>
      <nav
        aria-label="编辑工作区"
        className="border-border bg-card flex shrink-0 gap-1 border-b px-3 py-2 md:hidden"
      >
        {PANES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={activePane === key}
            aria-controls={`editor-pane-${key}`}
            onClick={() => onPaneChange(key)}
            className={`min-h-11 flex-1 rounded-md px-3 py-2 text-sm font-medium ${activePane === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {PANES.map(({ key, region }) => (
          <section
            key={key}
            id={`editor-pane-${key}`}
            aria-label={region}
            className={`${activePane === key ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 md:contents`}
          >
            {content[key]}
          </section>
        ))}
      </div>
    </>
  );
}
