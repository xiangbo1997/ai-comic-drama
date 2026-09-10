"use client";

import {
  DEFAULT_AI_DISCLOSURE,
  DISCLOSURE_TEXT_MAX_LEN,
  DISCLOSURE_HEAD_SEC_MIN,
  DISCLOSURE_HEAD_SEC_MAX,
  type DisclosurePosition,
  type DisclosureMode,
  type ResolvedAiDisclosure,
} from "@/lib/ai-disclosure";
import type { TitleCardCredentials } from "@/lib/title-cards";
import { ToggleRow } from "./CollapsibleSection";

/** 位置下拉的展示标签（与 DISCLOSURE_POSITIONS 一一对应） */
const POSITION_LABELS: Record<DisclosurePosition, string> = {
  tl: "左上角",
  tr: "右上角",
  bl: "左下角",
  br: "右下角",
  top: "顶部居中",
  bottom: "底部居中",
};

/** 显示时长模式的展示标签 */
const MODE_LABELS: Record<DisclosureMode, string> = {
  always: "全片显示",
  head: "仅片头显示",
};

/**
 * 合规面板：AI 生成内容提示标识 + 片头信息位编号。
 *
 * 法规依据（《微短剧管理办法》，国家广播电视总局令第 16 号，2026-09-01 施行）：
 * - 第三十四条：AI 生成、制作的微短剧应当「在每集明显位置添加提示标识」；
 * - 第二十七条：片头应「在明显位置标注剧名、许可证号、批准文件编号、节目编号」。
 *
 * ⚠️ 面板内所有数值（字号倍率 / 位置 / 秒数）均为可配置默认值，法规原文未规定
 * 量化参数——文案里不对用户做「已满足 X 秒/X 字号」这类承诺。
 */
export function AiDisclosurePanel({
  disclosure,
  credentials,
  onDisclosureChange,
  onCredentialsChange,
}: {
  /** 已解析的标识配置（含缺省填充，直接用于表单显示） */
  disclosure: ResolvedAiDisclosure;
  /** 片头信息位编号（第二十七条）；缺省为全空 */
  credentials: TitleCardCredentials;
  onDisclosureChange: (next: ResolvedAiDisclosure) => void;
  onCredentialsChange: (next: TitleCardCredentials) => void;
}) {
  const patch = (part: Partial<ResolvedAiDisclosure>) =>
    onDisclosureChange({ ...disclosure, ...part });

  return (
    <div className="space-y-4">
      {/* ── AI 生成提示标识（第三十四条）── */}
      <div className="space-y-2">
        <ToggleRow
          label="AI 生成提示标识（法定要求）"
          checked={disclosure.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          《微短剧管理办法》（广电总局令第 16 号，2026-09-01
          施行）第三十四条要求 AI 生成制作的微短剧在每集明显位置添加提示标识。
          默认开启；关闭后成片将不带标识，合规责任由发布方承担。
        </p>

        {disclosure.enabled && (
          <div className="space-y-3 pl-1">
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                提示文案
              </label>
              <input
                type="text"
                value={disclosure.text}
                maxLength={DISCLOSURE_TEXT_MAX_LEN}
                placeholder={DEFAULT_AI_DISCLOSURE.text}
                onChange={(e) => patch({ text: e.target.value })}
                className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-muted-foreground mb-1 block text-sm">
                  位置
                </label>
                <select
                  value={disclosure.position}
                  onChange={(e) =>
                    patch({ position: e.target.value as DisclosurePosition })
                  }
                  className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                >
                  {(Object.keys(POSITION_LABELS) as DisclosurePosition[]).map(
                    (p) => (
                      <option key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-sm">
                  显示时长
                </label>
                <select
                  value={disclosure.mode}
                  onChange={(e) =>
                    patch({ mode: e.target.value as DisclosureMode })
                  }
                  className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                >
                  {(Object.keys(MODE_LABELS) as DisclosureMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {disclosure.mode === "head" && (
              <div>
                <label className="text-muted-foreground mb-1 block text-sm">
                  片头显示秒数：{disclosure.headSec}s
                </label>
                <input
                  type="range"
                  min={DISCLOSURE_HEAD_SEC_MIN}
                  max={DISCLOSURE_HEAD_SEC_MAX}
                  step={1}
                  value={disclosure.headSec}
                  onChange={(e) => patch({ headSec: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 片头信息位编号（第二十七条）── */}
      <div className="border-border space-y-2 border-t pt-3">
        <p className="text-sm font-medium">片头信息位（选填）</p>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          第二十七条要求片头标注剧名、许可证号、批准文件编号、节目编号。剧名取自项目名自动标注；
          以下编号由持证方向主管部门取得，填写后会显示在片头标题卡（需开启片头卡），留空则不显示。
        </p>
        <div className="space-y-2 pl-1">
          <CredentialInput
            label="许可证号"
            value={credentials.licenseNo ?? ""}
            onChange={(licenseNo) =>
              onCredentialsChange({ ...credentials, licenseNo })
            }
          />
          <CredentialInput
            label="批准文件编号"
            value={credentials.approvalNo ?? ""}
            onChange={(approvalNo) =>
              onCredentialsChange({ ...credentials, approvalNo })
            }
          />
          <CredentialInput
            label="节目编号"
            value={credentials.programNo ?? ""}
            onChange={(programNo) =>
              onCredentialsChange({ ...credentials, programNo })
            }
          />
        </div>
      </div>
    </div>
  );
}

/** 单条编号输入行（三项结构一致，抽出避免重复） */
function CredentialInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs">
        {label}
      </label>
      <input
        type="text"
        value={value}
        maxLength={64}
        onChange={(e) => onChange(e.target.value)}
        className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
      />
    </div>
  );
}
