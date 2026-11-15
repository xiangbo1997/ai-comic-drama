import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineEditor } from "@/components/timeline-editor";
import {
  TimelineClipDialog,
  type TimelineClipKind,
} from "@/app/(dashboard)/editor/[id]/components/TimelineClipDialog";
import { AiDisclosureDialog } from "@/app/(dashboard)/editor/[id]/components/AiDisclosureDialog";
import {
  applySubtitleOverrides,
  type SubtitleOverride,
} from "@/lib/subtitle-overrides";
import { buildSubtitleSourceText } from "@/lib/subtitle-segments";
import type { AiDisclosure } from "@/lib/ai-disclosure";
import type { Scene } from "@/types";
import "../../src/app/globals.css";
const initial: Scene = {
  id: "s1",
  order: 4,
  duration: 3,
  shotType: "近景",
  description: "画面",
  dialogue: "原始对白",
  narration: null,
  emotion: "neutral",
  imageUrl: "/image.svg",
  audioUrl: "/voice.mp3",
  videoUrl: null,
  imageStatus: "COMPLETED",
  audioStatus: "COMPLETED",
  videoStatus: "PENDING",
};
function Fixture() {
  const [scene, setScene] = useState(initial);
  const [overrides, setOverrides] = useState<SubtitleOverride[]>([]);
  const [clip, setClip] = useState<TimelineClipKind | null>(null);
  const [fail, setFail] = useState(false);
  const [target, setTarget] = useState("");
  const [disclosure, setDisclosure] = useState<AiDisclosure>();
  const [showDisclosure, setShowDisclosure] = useState(false);
  const rendered = applySubtitleOverrides([scene], overrides);
  const check = () => {
    if (fail) throw new Error("保存失败，请重试");
  };
  return (
    <main className="bg-background text-foreground min-h-dvh [&_output]:block [&_output]:break-all">
      <label>
        <input
          type="checkbox"
          checked={fail}
          onChange={(e) => setFail(e.target.checked)}
        />
        模拟保存失败
      </label>
      <label>
        <input
          type="checkbox"
          onChange={(e) =>
            setScene((s) => ({
              ...s,
              imageStatus: e.target.checked ? "PROCESSING" : "COMPLETED",
            }))
          }
        />
        模拟生成中
      </label>
      <output aria-label="原始对白">{scene.dialogue}</output>
      <output aria-label="渲染字幕">
        {buildSubtitleSourceText(rendered[0])}
      </output>
      <output aria-label="配音地址">{scene.audioUrl}</output>
      <output aria-label="图片地址">{scene.imageUrl}</output>
      <output aria-label="编辑目标">{target}</output>
      <output aria-label="标识配置">{JSON.stringify(disclosure)}</output>
      <TimelineEditor
        scenes={rendered}
        selectedSceneId={null}
        onSceneSelect={() => {}}
        onSceneDurationChange={() => {}}
        onClipSelect={(_, kind) => setClip(kind)}
        onAiDisclosureClick={() => setShowDisclosure(true)}
      />
      {clip && (
        <TimelineClipDialog
          scene={scene}
          sceneNumber={1}
          kind={clip}
          subtitleOverride={overrides[0]?.text}
          onClose={() => setClip(null)}
          onOpenScene={() => {
            setTarget(`s1:${clip}`);
            setClip(null);
          }}
          onSaveAudioText={async (data) => {
            check();
            setScene((s) => ({ ...s, ...data }));
          }}
          onSaveSubtitle={async (text) => {
            check();
            setOverrides(text === null ? [] : [{ sceneId: "s1", text }]);
          }}
          onMediaEdit={async (kind, expectedUrl, url) => {
            check();
            if (scene[`${kind}Url`] !== expectedUrl)
              throw new Error("素材已变化");
            setScene((s) => ({ ...s, [`${kind}Url`]: url }));
          }}
        />
      )}
      {showDisclosure && (
        <AiDisclosureDialog
          initialValue={disclosure}
          onSave={async (next) => {
            check();
            setDisclosure(next);
          }}
          onClose={() => setShowDisclosure(false)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
