"use client";

import { useState } from "react";
import type { Scene } from "@/types";
import { buildSubtitleSourceText } from "@/lib/subtitle-segments";
import { MAX_SUBTITLE_TEXT_LENGTH } from "@/lib/subtitle-overrides";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TimelineClipKind = "image" | "video" | "audio" | "subtitle";
const LABELS: Record<TimelineClipKind, string> = {
  image: "图片",
  video: "视频",
  audio: "配音",
  subtitle: "字幕",
};

interface Props {
  scene: Scene;
  sceneNumber: number;
  kind: TimelineClipKind;
  subtitleOverride?: string;
  onClose: () => void;
  onOpenScene: () => void;
  onSaveSubtitle: (text: string | null) => Promise<unknown>;
  onMediaEdit: (
    kind: "image" | "video" | "audio",
    expectedUrl: string | null,
    url: string | null
  ) => Promise<unknown>;
  onSaveAudioText?: (
    data: Pick<Scene, "dialogue" | "narration" | "ttsSpeed">
  ) => Promise<unknown>;
}

export function TimelineClipDialog({
  scene,
  sceneNumber,
  kind,
  subtitleOverride,
  onClose,
  onOpenScene,
  onSaveSubtitle,
  onMediaEdit,
  onSaveAudioText,
}: Props) {
  const [text, setText] = useState(
    subtitleOverride ?? buildSubtitleSourceText(scene)
  );
  const [removedUrl, setRemovedUrl] = useState<string | null>(null);
  const [dialogue, setDialogue] = useState(scene.dialogue ?? "");
  const [narration, setNarration] = useState(scene.narration ?? "");
  const [ttsSpeed, setTtsSpeed] = useState(scene.ttsSpeed ?? 1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = kind === "subtitle" ? null : scene[`${kind}Url`];
  const processing =
    kind !== "subtitle" && scene[`${kind}Status`] === "PROCESSING";
  async function perform(action: () => Promise<unknown>, success: () => void) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
      success();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            第{sceneNumber}镜 · {LABELS[kind]}
          </DialogTitle>
          <DialogDescription>
            {kind === "subtitle"
              ? "单独修改字幕，不改变对白、旁白和已生成的配音。"
              : "从本镜移除素材会保留原文件和已有历史版本。"}
          </DialogDescription>
        </DialogHeader>
        {kind === "subtitle" ? (
          <>
            <textarea
              aria-label="本镜字幕"
              className="border-border bg-secondary min-h-32 w-full rounded-lg border p-3 text-sm"
              value={text}
              maxLength={MAX_SUBTITLE_TEXT_LENGTH}
              onChange={(e) => setText(e.target.value)}
              disabled={pending}
            />
            <p className="text-muted-foreground text-xs">
              {text.length}/{MAX_SUBTITLE_TEXT_LENGTH} ·
              清空文字并保存可隐藏本镜字幕。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  void perform(
                    () => onSaveSubtitle(text),
                    () => setNotice("字幕已保存")
                  )
                }
              >
                保存字幕
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void perform(
                    () => onSaveSubtitle(""),
                    () => {
                      setText("");
                      setNotice("本镜字幕已移除，配音保留");
                    }
                  )
                }
              >
                移除本镜字幕
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void perform(
                    () => onSaveSubtitle(null),
                    () => {
                      setText(buildSubtitleSourceText(scene));
                      setNotice("已恢复原文字幕");
                    }
                  )
                }
              >
                恢复原文字幕
              </Button>
            </div>
          </>
        ) : (
          <>
            {url ? (
              kind === "image" ? (
                <img
                  src={url}
                  alt={`第${sceneNumber}镜图片`}
                  className="max-h-64 w-full rounded-lg object-contain"
                />
              ) : kind === "audio" ? (
                <audio src={url} controls className="w-full" />
              ) : (
                <video
                  src={url}
                  controls
                  playsInline
                  className="max-h-64 w-full rounded-lg"
                />
              )
            ) : (
              <p className="text-muted-foreground rounded-lg border p-4 text-sm">
                本镜暂无{LABELS[kind]}
              </p>
            )}
            {kind === "audio" && onSaveAudioText && (
              <fieldset disabled={pending || processing} className="space-y-3">
                <label className="block text-sm">
                  配音对白
                  <textarea
                    aria-label="配音对白"
                    value={dialogue}
                    onChange={(e) => setDialogue(e.target.value)}
                    maxLength={5000}
                    rows={2}
                    className="bg-secondary mt-1 w-full rounded p-2"
                  />
                </label>
                <label className="block text-sm">
                  配音旁白
                  <textarea
                    aria-label="配音旁白"
                    value={narration}
                    onChange={(e) => setNarration(e.target.value)}
                    maxLength={5000}
                    rows={2}
                    className="bg-secondary mt-1 w-full rounded p-2"
                  />
                </label>
                <label className="block text-sm">
                  配音语速
                  <select
                    aria-label="配音语速"
                    value={ttsSpeed}
                    onChange={(e) => setTtsSpeed(Number(e.target.value))}
                    className="bg-secondary ml-3 rounded p-2"
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                      <option key={speed} value={speed}>
                        {speed}x
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  onClick={() =>
                    void perform(
                      () => onSaveAudioText({ dialogue, narration, ttsSpeed }),
                      () =>
                        setNotice("配音原文已保存，请在分镜卡片重新生成配音")
                    )
                  }
                >
                  保存配音原文
                </Button>
              </fieldset>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={onOpenScene}>
                打开分镜编辑
              </Button>
              <Button
                variant="outline"
                disabled={pending || processing || !url}
                onClick={() =>
                  void perform(
                    () => onMediaEdit(kind, url, null),
                    () => {
                      setRemovedUrl(url);
                      setNotice(`${LABELS[kind]}已移除，可在此撤销`);
                    }
                  )
                }
              >
                移除{LABELS[kind]}
              </Button>
              {removedUrl && (
                <Button
                  variant="outline"
                  disabled={pending || processing || !!url}
                  onClick={() =>
                    void perform(
                      () => onMediaEdit(kind, null, removedUrl),
                      () => {
                        setRemovedUrl(null);
                        setNotice("已撤销移除");
                      }
                    )
                  }
                >
                  撤销移除
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {processing
                ? "本镜素材正在生成，完成后可移除。"
                : kind === "audio"
                  ? "编辑配音原文或语速后，在分镜卡片重新生成配音；不会自动消费积分。"
                  : "可在分镜编辑中修改描述、迭代图片或重新生成素材。"}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-primary text-sm">
            {notice}
          </p>
        )}
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          {pending ? "保存中…" : "关闭"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
