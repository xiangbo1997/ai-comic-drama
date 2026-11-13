import { useState, type ComponentProps } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { SceneList } from "@/app/(dashboard)/editor/[id]/components/SceneList";
import { TimelineEditor } from "@/components/timeline-editor";
import { SceneEffectDialog } from "@/app/(dashboard)/editor/[id]/components/SceneEffectDialog";
import { TransitionDialog } from "@/app/(dashboard)/editor/[id]/components/TransitionDialog";
import { StickerDialog } from "@/app/(dashboard)/editor/[id]/components/StickerDialog";
import { WatermarkDialog } from "@/app/(dashboard)/editor/[id]/components/WatermarkDialog";
import { SubtitleStyleDialog } from "@/app/(dashboard)/editor/[id]/components/SubtitleStyleDialog";
import { ToastProvider } from "@/components/ui/toast";
import type { ProjectDetail, Scene } from "@/types";

const noop = () => {};
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const initialScenes = Array.from({ length: 24 }, (_, order) => ({
  id: `scene-${order + 1}`,
  order,
  shotType: "近景",
  description: `镜头${order + 1}：少女打开门，发现另一个自己。`,
  duration: 4,
  dialogue: "别开门。",
  narration: null,
  emotion: "fear",
  imageStatus: "PENDING",
  videoStatus: "PENDING",
  audioStatus: "PENDING",
  imageUrl: null,
  videoUrl: null,
  audioUrl: null,
  selectedCharacterIds: [],
})) as Scene[];
const media = { onChange: noop, onOpenMultiSelect: noop };

function InteractionContent() {
  const generateImageMutation = useMutation<
    unknown,
    Error,
    { sceneId: string; scene: Scene; imageConfigId?: string }
  >({ mutationFn: async () => ({}) });
  const generateVideoMutation = useMutation<
    unknown,
    Error,
    { sceneId: string; scene: Scene; videoConfigId?: string }
  >({ mutationFn: async () => ({}) });
  const generateAudioMutation = useMutation<
    unknown,
    Error,
    { sceneId: string; scene: Scene; ttsConfigId?: string }
  >({ mutationFn: async () => ({}) });
  const [scenes, setScenes] = useState(() =>
    initialScenes.map((scene) => ({
      ...scene,
      order: location.search.includes("onebased")
        ? scene.order + 1
        : scene.order,
      duration:
        location.search.includes("long") && scene.order === 0
          ? 52
          : scene.duration,
    }))
  );
  const [dialog, setDialog] = useState<
    "effects" | "transition" | "stickers" | "watermark" | "subtitle" | null
  >(null);
  const [lastDuration, setLastDuration] = useState(0);
  const [saved, setSaved] = useState("");
  const props = {
    project: {
      id: "fixture-project",
      characters: [],
      scenes,
    } as unknown as ProjectDetail,
    projectId: "fixture-project",
    selectedSceneId: null,
    onSceneSelect: noop,
    onManageCharacters: noop,
    generateImageMutation,
    generateVideoMutation,
    generateAudioMutation,
    updateScene: noop,
    mediaConfig: { image: media, video: media, audio: media },
    queryClient: {
      invalidateQueries: async () => {
        const response = await fetch("/fixture-order");
        const ids = (await response.json()) as string[];
        setScenes((current) =>
          ids.map((id, order) => ({
            ...current.find((s) => s.id === id)!,
            order,
          }))
        );
      },
    },
    onIterateScene: async () => {},
  } satisfies ComponentProps<typeof SceneList>;

  return (
    <main className="flex h-dvh min-w-0 flex-col">
      <output aria-label="已保存时长">{lastDuration}</output>
      <output aria-label="已保存装饰">{saved}</output>
      <SceneList {...props} />
      <div className="max-h-[25dvh] shrink-0 overflow-y-auto md:max-h-none">
        <TimelineEditor
          scenes={scenes}
          selectedSceneId={null}
          onSceneSelect={noop}
          onSceneDurationChange={(_, duration) => setLastDuration(duration)}
          onEffectClick={() => setDialog("effects")}
          onTransitionClick={() => setDialog("transition")}
          onStickerClick={() => setDialog("stickers")}
          onWatermarkClick={() => setDialog("watermark")}
          onSubtitleClick={() => setDialog("subtitle")}
        />
      </div>
      {dialog === "effects" && (
        <SceneEffectDialog
          scenes={scenes}
          onSave={() => setSaved("滤镜已保存")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "transition" && (
        <TransitionDialog
          scenes={scenes}
          onSave={() => setSaved("转场已保存")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "stickers" && (
        <StickerDialog
          initialStickers={[
            {
              id: "sticker",
              sceneId: "scene-1",
              imageUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
              x: 0.5,
              y: 0.5,
              scale: 0.2,
            },
          ]}
          scenes={scenes}
          onSave={() => setSaved("贴图已保存")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "watermark" && (
        <WatermarkDialog
          onSave={() => setSaved("水印已保存")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "subtitle" && (
        <SubtitleStyleDialog
          aspectRatio="9:16"
          onSave={() => setSaved("字幕已保存")}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}

export function InteractionFixture() {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <InteractionContent />
      </ToastProvider>
    </QueryClientProvider>
  );
}
