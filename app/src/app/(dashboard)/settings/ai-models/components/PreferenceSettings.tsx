"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { Preference } from "./types";

interface PreferenceSettingsProps {
  preference: Preference;
}

export function PreferenceSettings({ preference }: PreferenceSettingsProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(preference.concurrencyMode);
  const [maxConcurrent, setMaxConcurrent] = useState(preference.maxConcurrent);
  const [saving, setSaving] = useState(false);

  const savePreference = async () => {
    setSaving(true);
    try {
      await fetch("/api/ai-models/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrencyMode: mode, maxConcurrent }),
      });
      queryClient.invalidateQueries({ queryKey: ["ai-preferences"] });
    } catch {
      alert("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm text-gray-400">
          多版本生成策略
        </label>
        <div className="flex gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === "SERIAL"}
              onChange={() => setMode("SERIAL")}
              className="h-4 w-4 border-gray-600 bg-gray-700 text-blue-600"
            />
            <span className="text-gray-300">串行生成（节省资源）</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === "PARALLEL"}
              onChange={() => setMode("PARALLEL")}
              className="h-4 w-4 border-gray-600 bg-gray-700 text-blue-600"
            />
            <span className="text-gray-300">并行生成（更快）</span>
          </label>
        </div>
      </div>

      {mode === "PARALLEL" && (
        <div>
          <label className="mb-2 block text-sm text-gray-400">最大并发数</label>
          <select
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            className="rounded-lg bg-gray-700 px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={savePreference}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        保存设置
      </button>
    </div>
  );
}
