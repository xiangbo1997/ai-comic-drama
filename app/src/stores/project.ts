/**
 * NOTE（Stage 3.5）：
 * 当前 `useProjectStore` 暂未被任何组件消费——编辑器实际使用 `useEditorProject`
 * （React Query + 服务端真相）作为主数据源。此 store 保留为 **Stage 4 跨页协作 /
 * 离线编辑 / 多标签同步** 等场景的占位。
 *
 * 接入时建议按逻辑域拆分 slices，复用 zustand 的 combine middleware：
 *   - `projectSlice`：project 本体
 *   - `sceneSlice`：scenes 数组与相关 action
 *   - `characterSlice`：characters 数组
 *   - `uiSlice`：selectedSceneId / isGenerating 等 UI 态
 *
 * 切分前请先 grep 确认没有组件直接引用当前 flat store，避免破坏订阅者。
 */

import { create } from "zustand";
import type { Project, Scene, Character } from "@/types";

interface ProjectStore {
  // 状态
  project: Project | null;
  scenes: Scene[];
  characters: Character[];
  selectedSceneId: string | null;
  isGenerating: boolean;

  // 操作
  setProject: (project: Project | null) => void;
  setScenes: (scenes: Scene[]) => void;
  addScene: (scene: Scene) => void;
  updateScene: (id: string, updates: Partial<Scene>) => void;
  removeScene: (id: string) => void;
  reorderScenes: (fromIndex: number, toIndex: number) => void;
  setCharacters: (characters: Character[]) => void;
  addCharacter: (character: Character) => void;
  updateCharacter: (id: string, updates: Partial<Character>) => void;
  removeCharacter: (id: string) => void;
  setSelectedSceneId: (id: string | null) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: null,
  scenes: [],
  characters: [],
  selectedSceneId: null,
  isGenerating: false,

  setProject: (project) => set({ project }),

  setScenes: (scenes) => set({ scenes }),

  addScene: (scene) => set((state) => ({ scenes: [...state.scenes, scene] })),

  updateScene: (id, updates) =>
    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  // Stage 3.5：解耦跨域副作用。"删除场景时清空选中态"属于 UI 语义，不应由 scene
  // 操作隐式承担。调用方若需保持该行为，显式调用 `setSelectedSceneId(null)`。
  removeScene: (id) =>
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
    })),

  reorderScenes: (fromIndex, toIndex) =>
    set((state) => {
      const newScenes = [...state.scenes];
      const [removed] = newScenes.splice(fromIndex, 1);
      newScenes.splice(toIndex, 0, removed);
      return {
        scenes: newScenes.map((s, i) => ({ ...s, order: i })),
      };
    }),

  setCharacters: (characters) => set({ characters }),

  addCharacter: (character) =>
    set((state) => ({ characters: [...state.characters, character] })),

  updateCharacter: (id, updates) =>
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  removeCharacter: (id) =>
    set((state) => ({
      characters: state.characters.filter((c) => c.id !== id),
    })),

  setSelectedSceneId: (id) => set({ selectedSceneId: id }),

  setIsGenerating: (isGenerating) => set({ isGenerating }),

  reset: () =>
    set({
      project: null,
      scenes: [],
      characters: [],
      selectedSceneId: null,
      isGenerating: false,
    }),
}));
