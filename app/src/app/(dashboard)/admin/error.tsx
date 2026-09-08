"use client";

/**
 * 后台区域的客户端错误边界
 *
 * 没有它时，任一后台页面的渲染期异常会把整棵 React 树卸掉，浏览器只剩
 * 一个空白/「无法加载」页，用户看不到任何线索。这里兜住异常、展示错误
 * 文案并提供重试，同时把堆栈打到控制台便于排查。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error("[admin] 页面渲染异常:", error);
  }, [error]);

  return (
    <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-6">
      <h2 className="text-base font-semibold">后台页面出错了</h2>
      <p className="text-muted-foreground mt-2 text-sm break-all">
        {error.message || "未知错误"}
        {error.digest ? `（digest: ${error.digest}）` : ""}
      </p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => reset()}>
          重试
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => router.push("/admin")}
        >
          返回仪表盘
        </Button>
      </div>
    </div>
  );
}
