"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Loader2,
  Send,
  Brain,
  MessageSquare,
  Trash2,
  RefreshCw,
  Play,
} from "lucide-react";
import { AssistantExecutionPanel } from "./AssistantExecutionPanel";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelSelector } from "@/components/ai-models/model-selector";
import {
  useProjectAssistant,
  type AssistantTarget,
} from "./use-project-assistant";

type Props = AssistantTarget & {
  title: string;
  label?: string;
  className?: string;
  initialTab?: "chat" | "memory" | "execution";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
interface AssistantModelConfig {
  id: string;
  selectedModel: string | null;
  isDefault: boolean;
  testStatus: string | null;
  provider: { category: string };
}
async function fetchAssistantConfigs(): Promise<{
  configs: AssistantModelConfig[];
}> {
  const response = await fetch("/api/ai-models/configs");
  if (!response.ok) throw new Error("无法加载模型配置，请刷新页面重试");
  return response.json();
}

export function ProjectAssistantButton({
  title,
  label = "AI 助手",
  className,
  initialTab = "chat",
  open: controlledOpen,
  onOpenChange,
  ...target
}: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const key = target.projectId
    ? `project:${target.projectId}`
    : `series:${target.seriesId}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <Button
          variant="outline"
          size="sm"
          className={className}
          onClick={() => setOpen(true)}
        >
          <Bot size={16} />
          {label}
        </Button>
      )}
      {open && (
        <AssistantPanel
          key={key}
          target={target}
          title={title}
          initialTab={initialTab}
        />
      )}
    </Dialog>
  );
}

function AssistantPanel({
  target,
  title,
  initialTab,
}: {
  target: AssistantTarget;
  title: string;
  initialTab: "chat" | "memory" | "execution";
}) {
  const assistant = useProjectAssistant(target);
  const [tab, setTab] = useState<"chat" | "memory" | "execution">(initialTab);
  const [draft, setDraft] = useState("");
  const [config, setConfig] = useState<{ id: string; model: string }>();
  const {
    data: configData,
    isLoading: configsLoading,
    error: configsError,
  } = useQuery({
    queryKey: ["ai-configs"],
    queryFn: fetchAssistantConfigs,
    staleTime: 30000,
  });
  const availableConfigs = (configData?.configs ?? []).filter(
    (item) => item.provider.category === "LLM" && item.testStatus === "SUCCESS"
  );
  // 与模型选择器使用同一份配置和筛选规则，首发实际模型必须与界面显示一致。
  const chosenConfig =
    availableConfigs.find((item) => item.id === config?.id) ??
    availableConfigs.find((item) => item.isDefault) ??
    availableConfigs[0];
  const [confirmClear, setConfirmClear] = useState(false);
  const [failedSend, setFailedSend] = useState(false);
  const [sendingQuestion, setSendingQuestion] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const disabled =
    assistant.loading || assistant.pending || !assistant.snapshot;
  const chatDisabled =
    disabled || !!assistant.snapshot?.busy || configsLoading || !chosenConfig;
  const lastMessageId = assistant.snapshot?.messages.at(-1)?.id;
  useEffect(() => {
    if (tab === "chat" && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [lastMessageId, tab, sendingQuestion]);
  async function submit() {
    setSendingQuestion(draft);
    const sent = await assistant.send(
      draft,
      chosenConfig?.id,
      chosenConfig?.selectedModel || undefined
    );
    setSendingQuestion("");
    if (sent) {
      setDraft("");
      setFailedSend(false);
    } else setFailedSend(true);
  }

  return (
    <DialogContent className="top-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-xl">
      <DialogHeader className="border-border shrink-0 border-b p-5 pr-12 text-left">
        <DialogTitle className="flex items-center gap-2">
          <Bot size={20} />
          AI 创作助手
        </DialogTitle>
        <DialogDescription className="break-words">
          {assistant.snapshot?.scope.title || title} · 本剧独立记忆
        </DialogDescription>
        {target.projectId && assistant.snapshot?.scope.type === "series" && (
          <p className="text-muted-foreground text-xs">
            当前集：{title} · 同系列各集共享对话与记忆
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          可联网查资料、使用项目技能，并按你的要求修改本集内容；制作计划在「自动制作」确认执行。
        </p>
        {assistant.snapshot?.context && (
          <p className="text-muted-foreground text-xs">
            已关联：
            {assistant.snapshot.context.sources.join(" · ") || "当前剧集"}
            {assistant.snapshot.context.truncated ? "（较长内容已节选）" : ""}
          </p>
        )}
      </DialogHeader>
      <div
        role="tablist"
        aria-label="助手内容"
        className="border-border flex shrink-0 gap-2 border-b px-4 py-2"
      >
        <Button
          role="tab"
          aria-selected={tab === "chat"}
          variant={tab === "chat" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("chat")}
        >
          <MessageSquare size={15} />
          对话
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "memory"}
          variant={tab === "memory" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("memory")}
        >
          <Brain size={15} />
          剧集记忆
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "execution"}
          variant={tab === "execution" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("execution")}
        >
          <Play size={15} />
          自动制作
        </Button>
      </div>
      {assistant.error && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive m-4 mb-0 shrink-0 rounded-lg p-3 text-sm"
        >
          {assistant.error}
          {!assistant.snapshot && (
            <Button
              variant="outline"
              size="sm"
              onClick={assistant.reload}
              className="mt-2"
            >
              重新加载
            </Button>
          )}
        </div>
      )}
      {assistant.notice && (
        <p role="status" className="text-primary px-4 pt-3 text-sm">
          {assistant.notice}
        </p>
      )}
      {assistant.loading && (
        <div
          className="text-muted-foreground flex justify-center gap-2 p-5"
          aria-label="正在加载助手"
        >
          <Loader2 size={18} className="animate-spin" />
          加载对话与记忆…
        </div>
      )}
      {tab === "execution" ? (
        <AssistantExecutionPanel
          target={target}
          title={title}
          llmConfigId={chosenConfig?.id}
        />
      ) : tab === "chat" ? (
        <>
          <div
            ref={log}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
            role="log"
            aria-label="本剧对话"
            aria-busy={assistant.pending}
          >
            {assistant.snapshot?.hasMore && (
              <p className="text-muted-foreground text-center text-xs">
                当前显示最近 40 条消息；更早的聊天仍保存在本剧中。
              </p>
            )}
            {!assistant.loading &&
              assistant.snapshot?.messages.length === 0 && (
                <div className="text-muted-foreground space-y-3 py-6 text-sm">
                  <p>直接提问，一起梳理剧情、角色和制作决策。</p>
                  {[
                    "帮我检查当前剧情的冲突和节奏",
                    "角色的动机是否充分？",
                    "根据当前进度，下一步优先做什么？",
                  ].map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      className="h-auto w-full justify-start text-left whitespace-normal"
                      disabled={chatDisabled}
                      onClick={() => {
                        setDraft(prompt);
                        setFailedSend(false);
                      }}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              )}
            {assistant.snapshot?.messages.map((message) => (
              <article
                key={message.id}
                className={`rounded-xl p-3 ${message.role === "user" ? "bg-primary/10 ml-6" : "bg-secondary mr-3"}`}
              >
                <p className="text-muted-foreground mb-1 text-xs">
                  {message.role === "user" ? "你" : "AI 助手"}
                </p>
                {message.role === "assistant" ? (
                  <AssistantMarkdown content={message.content} />
                ) : (
                  <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                    {message.content}
                  </p>
                )}
                {message.role === "assistant" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className="mt-2 text-xs"
                    onClick={() => {
                      assistant.setMemoryDraft(
                        (prev) =>
                          `${prev}${prev ? "\n\n" : ""}${message.content}`
                      );
                      setTab("memory");
                    }}
                  >
                    加入记忆草稿
                  </Button>
                )}
              </article>
            ))}
            {sendingQuestion && (
              <article
                className="bg-primary/10 ml-6 rounded-xl p-3"
                aria-label="正在发送的问题"
              >
                <p className="text-muted-foreground mb-1 text-xs">
                  你 · 等待回复
                </p>
                <p className="text-sm break-words whitespace-pre-wrap">
                  {sendingQuestion}
                </p>
              </article>
            )}
            {assistant.pending && (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 size={15} className="animate-spin" />
                正在处理，请稍候…
              </p>
            )}
          </div>
          <div className="border-border shrink-0 space-y-3 border-t p-4">
            {assistant.snapshot?.busy && (
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                本剧有提问正在处理，请稍后刷新。
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <ModelSelector
                category="LLM"
                size="sm"
                value={chosenConfig?.id}
                onChange={(id, model) => {
                  setConfig({ id, model });
                  setFailedSend(false);
                }}
                disabled={chatDisabled}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="刷新聊天"
                disabled={disabled}
                onClick={assistant.refreshChat}
              >
                <RefreshCw size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={chatDisabled || !assistant.snapshot?.messages.length}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={14} />
                清空聊天
              </Button>
            </div>
            {configsError && (
              <p className="text-destructive text-xs">
                无法加载模型配置，请刷新页面重试。
              </p>
            )}
            {!configsLoading && !configsError && !chosenConfig && (
              <p className="text-muted-foreground text-xs">
                请先
                <a
                  href="/settings/ai-models"
                  className="text-primary underline"
                >
                  配置并测试文字模型
                </a>
                ，再发送提问。
              </p>
            )}
            {confirmClear && (
              <div className="border-border space-y-2 rounded-lg border p-3 text-sm">
                <p>清空本剧所有聊天？剧集记忆将保留。</p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={chatDisabled}
                    onClick={async () => {
                      await assistant.clearMessages();
                      setConfirmClear(false);
                    }}
                  >
                    确认清空
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmClear(false)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="space-y-2"
            >
              <textarea
                aria-label="向本剧助手提问"
                rows={3}
                maxLength={4000}
                value={draft}
                disabled={chatDisabled}
                placeholder="查资料、讨论剧情，或直接告诉我如何修改当前作品…"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setFailedSend(false);
                }}
                className="border-border bg-background focus:ring-primary max-h-40 min-h-20 w-full resize-y rounded-lg border p-3 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
              />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  {draft.length}/4000 · 使用你配置的文本模型
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={chatDisabled || !draft.trim()}
                >
                  <Send size={14} />
                  {failedSend ? "重试发送" : "发送"}
                </Button>
              </div>
            </form>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <p className="text-muted-foreground text-sm">
            保存已确认的设定、偏好和创作决定，后续对话会参考这些内容。助手回答需经你确认后保存。
          </p>
          <textarea
            aria-label="本剧记忆"
            rows={12}
            maxLength={12000}
            value={assistant.memoryDraft}
            onChange={(event) => assistant.setMemoryDraft(event.target.value)}
            disabled={disabled}
            className="border-border bg-background focus:ring-primary min-h-48 w-full flex-1 resize-none rounded-lg border p-3 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
          />
          <div className="text-muted-foreground text-xs">
            {assistant.memoryDraft.length}/12000
          </div>
          {assistant.memoryDraft.length > 12000 && (
            <p className="text-destructive text-sm">
              记忆超过 12000 字，请精简草稿后保存。
            </p>
          )}
          {assistant.memoryConflict && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={assistant.reload}
            >
              载入最新记忆（覆盖草稿）
            </Button>
          )}
          <Button
            onClick={() => void assistant.saveMemory()}
            disabled={
              disabled ||
              assistant.memoryConflict ||
              assistant.memoryDraft.length > 12000 ||
              assistant.memoryDraft === assistant.snapshot?.memory.content
            }
          >
            保存记忆
          </Button>
        </div>
      )}
    </DialogContent>
  );
}
