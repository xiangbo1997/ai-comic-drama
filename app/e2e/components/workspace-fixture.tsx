import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  EditorWorkspace,
  type EditorPane,
} from "@/app/(dashboard)/editor/[id]/components/EditorWorkspace";
import { ScriptPanel } from "@/app/(dashboard)/editor/[id]/components/ScriptPanel";
import { SceneEditor } from "@/app/(dashboard)/editor/[id]/components/SceneEditor";
import { EditorHeader } from "@/app/(dashboard)/editor/[id]/components/EditorHeader";
import { ToastProvider } from "@/components/ui/toast";
import { InteractionFixture } from "./interaction-fixture";
import { ProducerFixture } from "./producer-fixture";
import type { ProjectDetail, Scene } from "@/types";
import "@/app/globals.css";

const noop = () => {};
const scene = {
  id: "scene-1",
  order: location.search.includes("onebased") ? 1 : 0,
  shotType: "特写",
  description: "少女攥紧钥匙，门外传来脚步声。",
  dialogue: "别开门。",
  narration: null,
  emotion: "fear",
  duration: 3,
  imageUrl: null,
  videoUrl: null,
  audioUrl: null,
} as Scene;
const project = {
  id: "fixture-project",
  title: "手机创作验证",
  characters: [],
  scenes: [scene],
} as unknown as ProjectDetail;
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
queryClient.setQueryData(["ai-configs"], { configs: [] });

function Fixture() {
  const [pane, setPane] = useState<EditorPane>("script");
  const [input, setInput] = useState("");
  const [currentScene, setCurrentScene] = useState<Scene>();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <main className="flex h-dvh min-w-0 flex-col">
          <EditorHeader
            title="这是一个很长的漫剧项目名称用于检查手机标题不会挤走预览和导出入口"
            editingTitle={false}
            showTimeline={false}
            showSettings={false}
            hasScenes
            canExport={false}
            projectId={project.id}
            onTitleChange={noop}
            onTitleSave={noop}
            onEditTitle={noop}
            onToggleTimeline={noop}
            onToggleSettings={noop}
            onMusic={noop}
            onPreview={noop}
            onExport={noop}
            onSubtitle={noop}
            onWatermark={noop}
            onSticker={noop}
            onTransition={noop}
            onEffect={noop}
          />
          <EditorWorkspace
            activePane={pane}
            onPaneChange={setPane}
            script={
              <ScriptPanel
                inputText={input}
                onInputChange={setInput}
                onParse={noop}
                isParsing={false}
                parseError={null}
                project={project}
                showCharacterPanel
                onToggleCharacterPanel={noop}
                onManageCharacters={noop}
              />
            }
            scenes={
              <div className="flex min-w-0 flex-1 flex-col">
                <h2>分镜列表</h2>
                <button
                  onClick={() => {
                    setCurrentScene(scene);
                    setPane("edit");
                  }}
                >
                  选择分镜 1
                </button>
              </div>
            }
            editor={
              <SceneEditor
                scene={currentScene}
                sceneNumber={
                  currentScene
                    ? project.scenes.findIndex(
                        (candidate) => candidate.id === currentScene.id
                      ) + 1
                    : 0
                }
                projectId={project.id}
                aspectRatio="9:16"
                onImageConfigChange={noop}
                onOpenMultiImageDialog={noop}
                onUpdateScene={noop}
                onGenerateImage={noop}
                onIterateImage={noop}
                isGeneratingImage={false}
              />
            }
          />
        </main>
      </ToastProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  location.search.includes("producer") ? (
    <ProducerFixture />
  ) : location.search.includes("interactions") ? (
    <InteractionFixture />
  ) : (
    <Fixture />
  )
);
