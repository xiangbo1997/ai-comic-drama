"use client";

import type { ReactNode, CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * 通用可排序项包装组件。
 * 用 render prop 把拖拽手柄的 listeners/attributes 暴露给子内容，
 * 这样卡片本体可保留 onClick 选中，仅拖拽手柄触发排序，互不冲突。
 */
export function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    isDragging: boolean;
  }) => ReactNode;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}
