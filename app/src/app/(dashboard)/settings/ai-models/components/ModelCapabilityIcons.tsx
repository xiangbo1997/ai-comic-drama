"use client";

import { Cpu, Image as ImageIcon, Video, Volume2 } from "lucide-react";
import { inferModelCapability } from "./types";

export function ModelCapabilityIcons({ modelId }: { modelId: string }) {
  const capabilities = inferModelCapability(modelId);

  return (
    <span className="flex flex-shrink-0 items-center gap-0.5">
      {capabilities.includes("text") &&
        !capabilities.includes("multimodal") && (
          <span title="文本模型">
            <Cpu size={12} className="text-blue-400" />
          </span>
        )}
      {capabilities.includes("multimodal") && (
        <span className="flex items-center" title="多模态（文本+视觉理解）">
          <Cpu size={12} className="text-purple-400" />
          <span className="ml-0.5 text-[8px] text-purple-400">+👁</span>
        </span>
      )}
      {capabilities.includes("image") && (
        <span title="图像生成">
          <ImageIcon size={12} className="text-green-400" />
        </span>
      )}
      {capabilities.includes("video") && (
        <span title="视频生成">
          <Video size={12} className="text-orange-400" />
        </span>
      )}
      {capabilities.includes("audio") && (
        <span title="语音合成">
          <Volume2 size={12} className="text-cyan-400" />
        </span>
      )}
    </span>
  );
}
