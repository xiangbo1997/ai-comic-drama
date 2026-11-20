"use client";

import { useState } from "react";
import { Copy, Download, Import } from "lucide-react";
import { ScriptZ } from "@/lib/short-video/contracts";
import {
  buildCreationPrompt,
  parseScriptInput,
} from "@/lib/short-video/creation";

const buttonClass =
  "border-border hover:bg-muted focus-visible:ring-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-50";

export function CreationTools({
  title,
  brief,
  value,
  disabled,
  onImport,
}: {
  title: string;
  brief: string;
  value: string;
  disabled: boolean;
  onImport: (value: string) => void;
}) {
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const prompt = buildCreationPrompt({ title, brief, scriptText: value });
  let imported = null;
  try {
    imported = ScriptZ.safeParse(parseScriptInput(pasted));
  } catch {
    // 粘贴时允许暂存普通文本或未闭合 JSON，应用前统一校验。
  }
  const copy = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(prompt.text);
      setMessage("已复制，可粘贴到其他 AI 或创作平台");
    } catch {
      setError("浏览器未允许复制，请下载 TXT 或展开提示词手动复制。");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([prompt.text], { type: "text/plain;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "短视频"}-${prompt.ready ? "完整创作提示词" : "改编提示词"}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("已导出当前内容；在其他平台制作后可上传成片");
  };
  return (
    <div className="bg-primary/5 border-primary/20 min-w-0 space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">简单创作 · 也能交给其他平台</h3>
      <p className="text-muted-foreground text-sm">
        {prompt.ready
          ? "脚本已完整：可直接导出逐镜提示词，或保存后用现有编辑器制作。导出包含当前未保存的修改。"
          : "当前是参考简报或未完成草稿，还没有完整脚本。复制改编提示词给文本 AI，再把返回的脚本粘贴到下方即可。"}
      </p>
      <ol className="text-muted-foreground list-inside list-decimal space-y-1 text-sm">
        <li>复制或下载提示词，交给你常用的 AI。</li>
        <li>粘贴返回的脚本，检查分镜后保存新版本。</li>
        <li>用现有编辑器制作，或在其他平台制作后上传 MP4。</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => void copy()}
        >
          <Copy className="size-4" aria-hidden />
          {prompt.ready ? "复制完整创作提示词" : "复制改编提示词"}
        </button>
        <button type="button" className={buttonClass} onClick={download}>
          <Download className="size-4" aria-hidden /> 下载提示词 TXT
        </button>
      </div>
      <details>
        <summary className="cursor-pointer text-sm">查看导出的提示词</summary>
        <textarea
          aria-label="可复制的创作提示词"
          readOnly
          value={prompt.text}
          className="border-input bg-background mt-3 min-h-60 w-full rounded-lg border p-3 text-sm"
        />
      </details>
      <details>
        <summary className="cursor-pointer text-sm">粘贴 AI 返回的脚本</summary>
        <label className="mt-3 block space-y-2 text-sm">
          <span>脚本内容（支持 JSON 或带 JSON 代码块的回复）</span>
          <textarea
            className="border-input bg-background min-h-40 w-full rounded-lg border p-3 text-sm"
            value={pasted}
            disabled={disabled}
            onChange={(event) => {
              setPasted(event.target.value);
              setError("");
            }}
          />
        </label>
        {pasted && !imported?.success && (
          <p className="text-muted-foreground my-2 text-sm">
            尚未读到完整脚本。请复制 AI 回复中的完整 JSON
            代码块（需含角色、分镜、首帧及视频动作）。普通简报和表格可用于改编，不能直接当作脚本导入。
          </p>
        )}
        {imported?.success && (
          <p className="my-2 text-sm">
            已识别「{imported.data.title}」：{imported.data.shots.length} 镜 ·{" "}
            {imported.data.targetDurationSec} 秒 ·{" "}
            {imported.data.characters.length} 个角色
          </p>
        )}
        <button
          type="button"
          className={`${buttonClass} mt-2`}
          disabled={disabled || !imported?.success}
          onClick={() => {
            if (!imported?.success) return;
            if (
              value &&
              !window.confirm(
                "将用粘贴的脚本替换当前编辑内容。已保存版本仍保留，确定继续？"
              )
            )
              return;
            onImport(JSON.stringify(imported.data, null, 2));
            setPasted("");
            setMessage("脚本已填入下方，请检查后保存为新版本");
          }}
        >
          <Import className="size-4" aria-hidden /> 应用到脚本表单
        </button>
      </details>
      {message && (
        <p role="status" className="text-primary text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
