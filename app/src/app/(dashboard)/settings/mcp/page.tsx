"use client";

/**
 * MCP 接入设置页：签发/吊销密钥 + 接入引导。
 *
 * 安全要点：明文密钥只在签发响应里出现一次，页面用一次性卡片展示并提示立即保存；
 * 接入命令示范用环境变量展开而非把密钥硬编码进配置文件（配置文件常被提交进 git）。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { ErrorState } from "@/components/ui/query-state";
import { useToast } from "@/components/ui/toast";

interface McpKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  expired: boolean;
}

export default function McpSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [newKeyName, setNewKeyName] = useState("");
  // 刚签发的明文密钥：仅存在于本次渲染，刷新即消失（后端也取不回）
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<{ keys: McpKey[] }>({
    queryKey: ["mcp-keys"],
    queryFn: async () => {
      const res = await fetch("/api/user/mcp-keys");
      if (!res.ok) throw new Error("获取密钥列表失败");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/user/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "创建密钥失败");
      return json as { plaintext: string };
    },
    onSuccess: (json) => {
      setFreshKey(json.plaintext);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["mcp-keys"] });
      toast.success("密钥已创建，请立即保存");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/user/mcp-keys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "吊销失败");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-keys"] });
      toast.success("密钥已吊销");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRevoke = async (key: McpKey) => {
    const ok = await toast.confirm(
      `确定要吊销「${key.name}」吗？正在使用它的客户端会立即失效。`
    );
    if (!ok) return;
    revokeMutation.mutate(key.id);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message="密钥列表加载失败，请重试"
        onRetry={() =>
          queryClient.invalidateQueries({ queryKey: ["mcp-keys"] })
        }
        className="flex min-h-[400px] flex-col items-center justify-center"
      />
    );
  }

  const keys = data?.keys ?? [];

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-foreground mb-2 text-2xl font-bold">MCP 接入</h1>
        <p className="text-muted-foreground">
          把 AI 助手接进剧本工作台：在对话里起草世界观、写剧本、转分镜。
          出图、配音与导出仍在网页编辑器完成。
        </p>
      </div>

      {/* 新签发的密钥：一次性展示 */}
      {freshKey && (
        <div className="border-primary/40 bg-primary/5 mb-6 rounded-xl border p-5">
          <div className="mb-3 flex items-start gap-2">
            <AlertTriangle className="text-primary mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-foreground font-medium">
                请立即保存，此密钥只显示这一次
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                关闭后无法再次查看。密钥等同账号密码，泄露者可用你的额度生成内容。
              </p>
            </div>
          </div>
          <div className="bg-card flex items-center gap-2 rounded-lg p-3">
            <code className="text-foreground flex-1 font-mono text-sm break-all">
              {freshKey}
            </code>
            <button
              onClick={() => copy(freshKey, "fresh")}
              className="bg-primary hover:bg-primary/90 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white transition"
            >
              {copied === "fresh" ? <Check size={13} /> : <Copy size={13} />}
              {copied === "fresh" ? "已复制" : "复制"}
            </button>
          </div>
          <button
            onClick={() => setFreshKey(null)}
            className="text-muted-foreground hover:text-foreground mt-3 text-xs transition"
          >
            我已保存，关闭
          </button>
        </div>
      )}

      {/* 密钥列表 */}
      <div className="bg-card mb-6 rounded-xl p-6">
        <h2 className="text-foreground mb-4 flex items-center gap-2 text-lg font-semibold">
          <KeyRound size={18} />
          接入密钥
        </h2>

        <div className="mb-4 flex gap-2">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="密钥用途，如「我的 MacBook」"
            maxLength={50}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          />
          <button
            onClick={() => createMutation.mutate(newKeyName.trim())}
            disabled={!newKeyName.trim() || createMutation.isPending}
            className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm text-white transition disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            创建密钥
          </button>
        </div>

        {keys.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            还没有密钥。创建一把后即可在 AI 助手里接入。
          </p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="border-border flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm font-medium">
                      {key.name}
                    </span>
                    {key.expired && (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-500">
                        已过期
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                    {key.keyPrefix}••••••••
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    创建于 {new Date(key.createdAt).toLocaleDateString("zh-CN")}
                    {key.lastUsedAt
                      ? ` · 最近使用 ${new Date(key.lastUsedAt).toLocaleDateString("zh-CN")}`
                      : " · 从未使用"}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(key)}
                  disabled={revokeMutation.isPending}
                  className="text-muted-foreground shrink-0 rounded-lg p-2 transition hover:bg-red-500/10 hover:text-red-500"
                  title="吊销"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 接入引导 */}
      <div className="bg-card rounded-xl p-6">
        <h2 className="text-foreground mb-4 text-lg font-semibold">接入方式</h2>

        <p className="text-muted-foreground mb-3 text-sm">
          在终端执行（把密钥放进环境变量，避免硬编码进会被提交的配置文件）：
        </p>
        <CommandBlock
          label="cli"
          copied={copied}
          onCopy={copy}
          command={`export COMIC_DRAMA_KEY="粘贴你的密钥"
claude mcp add --transport http comic-drama ${getOrigin()}/api/mcp \\
  --header "Authorization: Bearer $COMIC_DRAMA_KEY"`}
        />

        <div className="border-border mt-6 border-t pt-4">
          <h3 className="text-foreground mb-2 text-sm font-medium">
            接进来能做什么
          </h3>
          <ul className="text-muted-foreground space-y-1.5 text-sm">
            <li>· 一句话想法 → 世界观、主角、题材、片名</li>
            <li>· 生成结构化短剧脚本，按爆款方法论自审打磨</li>
            <li>· 脚本直转分镜列表并落库</li>
            <li>· 批量起草角色人设</li>
            <li>· 读取项目、分镜、角色、系列故事圣经</li>
          </ul>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            以上均为文本环节，不消耗积分。出图、配音、视频与导出需要看画面判断效果，
            仍在网页编辑器完成——每个工具都会返回编辑器链接方便跳转。
          </p>
        </div>
      </div>
    </div>
  );
}

/** 站点地址：客户端直接读当前 origin，保证复制出来的命令可用 */
function getOrigin(): string {
  if (typeof window === "undefined") return "https://<你的域名>";
  return window.location.origin;
}

function CommandBlock({
  command,
  label,
  copied,
  onCopy,
}: {
  command: string;
  label: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="bg-background border-border relative rounded-lg border p-3">
      <pre className="text-foreground overflow-x-auto pr-16 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {command}
      </pre>
      <button
        onClick={() => onCopy(command, label)}
        className="bg-secondary hover:bg-secondary/80 absolute top-2 right-2 flex items-center gap-1 rounded px-2 py-1 text-[11px] transition"
      >
        {copied === label ? <Check size={11} /> : <Copy size={11} />}
        {copied === label ? "已复制" : "复制"}
      </button>
    </div>
  );
}
