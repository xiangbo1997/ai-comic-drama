"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** 可折叠分节组件 */
export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-border rounded-lg border">
      {/* 节标题 */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="hover:bg-secondary/50 flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition-colors"
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* 折叠内容 */}
      {open && (
        <div className="border-border border-t px-4 pt-3 pb-4">{children}</div>
      )}
    </div>
  );
}

/** 开关行（复用弹窗内一致的 switch 视觉，与 SubtitleStylePanel 风格一致） */
export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`focus:ring-primary relative h-5 w-9 rounded-full transition-colors focus:ring-2 focus:outline-none ${
          checked ? "bg-primary" : "bg-secondary border-border border"
        }`}
      >
        <span
          className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
