"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings } from "lucide-react";
import type { CharacterListItem, Tag } from "@/types";
import { useDebounce } from "@/hooks/use-debounce";
import {
  toAppearanceFormData,
  isAppearanceEmpty,
} from "@/components/appearance-editor";
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  fetchCharacterUsage,
  generateReference,
  selectReference,
  generateThreeViews,
  fetchTags,
  generateDescription,
  type CharacterFormData,
  type GenerateOptions,
  type ReferenceCandidate,
} from "./components/constants";
import { toFriendlyError } from "@/lib/error-copy";
import { ErrorState, LoadingState } from "@/components/ui/query-state";
import { SearchAndFilter } from "./components/SearchAndFilter";
import { CharacterCard } from "./components/CharacterCard";
import { CreateCharacterModal } from "./components/CreateCharacterModal";
import { TagManagerModal } from "./components/TagManagerModal";
import { GenerateReferenceModal } from "./components/GenerateReferenceModal";
import { ReferenceCandidateGallery } from "./components/ReferenceCandidateGallery";
import { useToast } from "@/components/ui/toast";

export default function CharactersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [uploadingBaseImageId, setUploadingBaseImageId] = useState<
    string | null
  >(null);
  const [showTagManager, setShowTagManager] = useState(false);

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateModalCharacterId, setGenerateModalCharacterId] = useState<
    string | null
  >(null);
  const [generateOptions, setGenerateOptions] = useState<GenerateOptions>({
    source: "none",
    customPrompt: "",
    uploadedImage: null,
    imageConfigId: undefined,
    count: 1,
  });

  // 多候选画廊（批次 2 · 1.4B）：生成完成弹候选，点选一张入库。
  // gallery 与 generateModal 独立，用生成的角色 ID 定位入库目标。
  const [candidateGallery, setCandidateGallery] = useState<{
    characterId: string;
    candidates: ReferenceCandidate[];
  } | null>(null);
  const [selectingUrl, setSelectingUrl] = useState<string | null>(null);

  const [currentImageIndices, setCurrentImageIndices] = useState<
    Record<string, number>
  >({});
  const [showAppearanceEditor, setShowAppearanceEditor] = useState(false);
  const [formData, setFormData] = useState<CharacterFormData>({
    name: "",
    gender: "female",
    age: "",
    description: "",
    voiceId: "",
    voiceProvider: "volcano",
    tagIds: [],
    appearance: toAppearanceFormData(null),
  });

  const handleNextImage = useCallback(
    (characterId: string, totalImages: number) => {
      setCurrentImageIndices((prev) => ({
        ...prev,
        [characterId]: ((prev[characterId] || 0) + 1) % totalImages,
      }));
    },
    []
  );

  const handlePrevImage = useCallback(
    (characterId: string, totalImages: number) => {
      setCurrentImageIndices((prev) => ({
        ...prev,
        [characterId]:
          ((prev[characterId] || 0) - 1 + totalImages) % totalImages,
      }));
    },
    []
  );

  const handleDeleteImage = useCallback(
    async (characterId: string, imageIndex: number) => {
      const ok = await toast.confirm("确定要删除这张图片吗？");
      if (!ok) return;
      try {
        const res = await fetch(
          `/api/characters/${characterId}/images?index=${imageIndex}`,
          {
            method: "DELETE",
          }
        );
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "删除失败");
        }
        setCurrentImageIndices((prev) => {
          const newIndices = { ...prev };
          delete newIndices[characterId];
          return newIndices;
        });
        queryClient.invalidateQueries({ queryKey: ["characters"] });
        toast.success("图片已删除");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除失败");
      }
    },
    [toast, queryClient]
  );

  const openGenerateModal = useCallback(
    (
      characterId: string,
      defaultSource: "none" | "upload" | "existing" = "none"
    ) => {
      setGenerateModalCharacterId(characterId);
      setGenerateOptions({
        source: defaultSource,
        customPrompt: "",
        uploadedImage: null,
        imageConfigId: undefined,
        count: 1,
      });
      setShowGenerateModal(true);
    },
    []
  );

  const closeGenerateModal = () => {
    setShowGenerateModal(false);
    setGenerateModalCharacterId(null);
    setGenerateOptions({
      source: "none",
      customPrompt: "",
      uploadedImage: null,
      imageConfigId: undefined,
      count: 1,
    });
  };

  const handleGenerate = () => {
    if (!generateModalCharacterId) return;
    const options: {
      baseImage?: string;
      customPrompt?: string;
      useExistingImage?: boolean;
      existingImageIndex?: number;
      imageConfigId?: string;
      count?: number;
    } = {};
    if (generateOptions.customPrompt.trim()) {
      options.customPrompt = generateOptions.customPrompt.trim();
    }
    if (generateOptions.imageConfigId) {
      options.imageConfigId = generateOptions.imageConfigId;
    }
    if (generateOptions.source === "upload" && generateOptions.uploadedImage) {
      options.baseImage = generateOptions.uploadedImage;
    } else if (generateOptions.source === "existing") {
      options.useExistingImage = true;
      options.existingImageIndex =
        currentImageIndices[generateModalCharacterId] || 0;
    }
    // 多候选档位（缺省 1，零回归）
    options.count = generateOptions.count ?? 1;
    generateMutation.mutate({ id: generateModalCharacterId, options });
    closeGenerateModal();
  };

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: fetchTags,
  });

  const tagsByCategory = useMemo(
    () =>
      tags.reduce(
        (acc, tag) => {
          const category = tag.category || "other";
          if (!acc[category]) acc[category] = [];
          acc[category].push(tag);
          return acc;
        },
        {} as Record<string, Tag[]>
      ),
    [tags]
  );

  // 搜索框每次按键都会触发一次角色列表请求（queryKey 直接吃 searchQuery）。
  // 用防抖值喂 queryKey，输入本身仍即时受控，只延后触发查询（ux P2-2）。
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const {
    data: characters,
    isLoading,
    isError,
  } = useQuery<CharacterListItem[]>({
    queryKey: ["characters", debouncedSearchQuery, selectedTagIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchQuery.trim())
        params.set("search", debouncedSearchQuery.trim());
      if (selectedTagIds.length > 0)
        params.set("tags", selectedTagIds.join(","));
      const query = params.toString();
      const res = await fetch(`/api/characters${query ? `?${query}` : ""}`);
      if (!res.ok) {
        if (res.status === 401) return [];
        throw new Error("获取角色列表失败");
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      gender: "female",
      age: "",
      description: "",
      voiceId: "",
      voiceProvider: "volcano",
      tagIds: [],
      appearance: toAppearanceFormData(null),
    });
    setShowAppearanceEditor(false);
  };

  // CRUD 三 mutation 补 onError：此前失败完全静默，弹窗关闭 + loading 结束，
  // 用户误以为成功——「欺骗性成功」比报错更糟（ux-config P1-4）
  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setShowCreateModal(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(toFriendlyError(error, "创建角色失败").message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setEditingId(null);
    },
    onError: (error) => {
      toast.error(toFriendlyError(error, "保存角色失败").message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
    onError: (error) => {
      toast.error(toFriendlyError(error, "删除角色失败").message);
    },
  });

  // 点选一张候选入库（批次 2 · 1.4B）：不扣费，成功后刷新角色列表
  const selectMutation = useMutation({
    mutationFn: ({ id, imageUrl }: { id: string; imageUrl: string }) =>
      selectReference(id, imageUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setCandidateGallery(null);
      toast.success("参考图已保存");
    },
    onError: (error) => {
      toast.error(toFriendlyError(error, "保存参考图失败").message);
    },
    onSettled: () => {
      setSelectingUrl(null);
    },
  });

  const generateMutation = useMutation({
    mutationFn: ({
      id,
      options,
    }: {
      id: string;
      options?: {
        baseImage?: string;
        customPrompt?: string;
        useExistingImage?: boolean;
        existingImageIndex?: number;
        imageConfigId?: string;
        count?: number;
      };
    }) => generateReference(id, options || {}),
    onSuccess: (data, { id }) => {
      const candidates = data.candidates ?? [];
      if (candidates.length === 0) {
        toast.error("未生成任何候选参考图，请重试");
        return;
      }
      // 单张（count=1，零回归）：自动入库，不弹画廊
      if (candidates.length === 1) {
        setSelectingUrl(candidates[0].imageUrl);
        selectMutation.mutate({ id, imageUrl: candidates[0].imageUrl });
        return;
      }
      // 多张：弹候选画廊供点选
      setCandidateGallery({ characterId: id, candidates });
    },
    onError: (error) => {
      // 积分不足附「去充值」出口（消息已含差额），不足时不再是死胡同
      const fe = toFriendlyError(error, "生成参考图失败");
      toast.error(fe.message, fe.cta);
    },
    onSettled: () => {
      setUploadingBaseImageId(null);
    },
  });

  // 一键三视图（正/侧/背，防生成崩坏）
  const generateThreeViewsMutation = useMutation({
    mutationFn: ({
      id,
      imageConfigId,
    }: {
      id: string;
      imageConfigId?: string;
    }) => generateThreeViews(id, { imageConfigId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      toast.success("三视图生成成功");
    },
    onError: (error) => {
      const fe = toFriendlyError(error, "生成三视图失败");
      toast.error(fe.message, fe.cta);
    },
  });

  const generateDescriptionMutation = useMutation({
    mutationFn: generateDescription,
    onSuccess: (data) => {
      setFormData((prev) => ({ ...prev, description: data.description }));
    },
    onError: (error) => {
      const fe = toFriendlyError(error, "生成描述失败");
      toast.error(fe.message, fe.cta);
    },
  });

  const handleCreate = () => {
    if (!formData.name.trim()) return;
    const payload = {
      ...formData,
      appearance: isAppearanceEmpty(formData.appearance)
        ? undefined
        : formData.appearance,
    };
    createMutation.mutate(payload);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      // 删除前查询引用情况，把「相关分镜将失去该角色」的级联后果讲清楚。
      // API 删除时会 array_remove 清理各分镜引用，此前确认框对此只字未提
      // （ux-config P0-3）。查询失败时降级为通用文案，不阻塞删除。
      const usage = await fetchCharacterUsage(id).catch(() => null);
      const parts: string[] = [];
      if (usage && usage.projectCount > 0)
        parts.push(`${usage.projectCount} 个项目`);
      if (usage && usage.sceneCount > 0)
        parts.push(`${usage.sceneCount} 个分镜`);
      const ok = await toast.confirm(
        parts.length > 0
          ? `该角色正被 ${parts.join("、")} 使用。\n删除后相关分镜将移除该角色（影响后续出图一致性），且无法恢复。确定删除？`
          : "确定要删除这个角色吗？删除后无法恢复。"
      );
      if (ok) {
        deleteMutation.mutate(id);
      }
    },
    [toast, deleteMutation]
  );

  const startEdit = useCallback((character: CharacterListItem) => {
    setEditingId(character.id);
    const appearanceData = toAppearanceFormData(character.appearance);
    setFormData({
      name: character.name,
      gender: character.gender || "female",
      age: character.age || "",
      description: character.description || "",
      voiceId: character.voiceId || "",
      voiceProvider: character.voiceProvider || "volcano",
      tagIds: character.tags?.map(({ tag }) => tag.id) || [],
      appearance: appearanceData,
    });
    setShowAppearanceEditor(!isAppearanceEmpty(appearanceData));
  }, []);

  const handleUpdate = useCallback(() => {
    if (!editingId || !formData.name.trim()) return;
    const payload = {
      ...formData,
      appearance: isAppearanceEmpty(formData.appearance)
        ? null
        : formData.appearance,
    };
    updateMutation.mutate({ id: editingId, data: payload });
  }, [editingId, formData, updateMutation]);

  // 稳定这两个 setter 回调，避免每次渲染生成新引用击穿 CharacterCard 的 memo
  const toggleAppearanceEditor = useCallback(
    () => setShowAppearanceEditor((v) => !v),
    []
  );
  const cancelEdit = useCallback(() => setEditingId(null), []);

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">角色库</h1>
          <p className="text-muted-foreground mt-1">
            管理你的角色，确保生成时保持一致性
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTagManager(true)}
            className="border-border text-foreground hover:bg-secondary flex items-center gap-2 rounded-lg border px-4 py-2 transition"
          >
            <Settings size={18} />
            管理标签
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition"
          >
            <Plus size={20} />
            创建角色
          </button>
        </div>
      </div>

      <SearchAndFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedTagIds={selectedTagIds}
        onSelectedTagIdsChange={setSelectedTagIds}
        tagsByCategory={tagsByCategory}
      />

      {isLoading && <LoadingState />}

      {/* 补 error 分支：此前加载失败页面直接空白，用户误判"没数据"且无重试
          入口（ux-crosscut P1-5） */}
      {!isLoading && isError && (
        <ErrorState
          message="角色列表加载失败，请重试"
          onRetry={() =>
            queryClient.invalidateQueries({ queryKey: ["characters"] })
          }
        />
      )}

      {!isLoading && !isError && characters?.length === 0 && (
        <div className="py-20 text-center">
          <div className="mb-4 text-6xl">👤</div>
          <h2 className="text-foreground mb-2 text-xl font-semibold">
            还没有角色
          </h2>
          <p className="text-muted-foreground mb-6">
            创建角色卡，让 AI 生成时保持角色一致性
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-medium transition"
          >
            <Plus size={20} />
            创建角色
          </button>
        </div>
      )}

      {!isLoading && !isError && characters && characters.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              isEditing={editingId === character.id}
              formData={formData}
              onFormDataChange={setFormData}
              showAppearanceEditor={showAppearanceEditor}
              onToggleAppearanceEditor={toggleAppearanceEditor}
              tags={tags}
              currentImageIndex={currentImageIndices[character.id] || 0}
              onNextImage={handleNextImage}
              onPrevImage={handlePrevImage}
              onDeleteImage={handleDeleteImage}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onOpenGenerateModal={openGenerateModal}
              uploadingBaseImageId={uploadingBaseImageId}
              generateMutationPending={generateMutation.isPending}
              updateMutationPending={updateMutation.isPending}
              generateDescriptionMutation={generateDescriptionMutation}
            />
          ))}

          <button
            onClick={() => setShowCreateModal(true)}
            className="border-border bg-card/50 hover:border-primary flex aspect-[3/4] flex-col items-center justify-center rounded-xl border-2 border-dashed transition"
          >
            <Plus size={40} className="text-muted-foreground mb-2" />
            <span className="text-muted-foreground">添加角色</span>
          </button>
        </div>
      )}

      {showCreateModal && (
        <CreateCharacterModal
          formData={formData}
          onFormDataChange={setFormData}
          showAppearanceEditor={showAppearanceEditor}
          onToggleAppearanceEditor={() => setShowAppearanceEditor((v) => !v)}
          tags={tags}
          onClose={() => {
            setShowCreateModal(false);
            resetForm();
          }}
          onCreate={handleCreate}
          createPending={createMutation.isPending}
          generateDescriptionMutation={generateDescriptionMutation}
        />
      )}

      {showTagManager && (
        <TagManagerModal
          tags={tags}
          tagsByCategory={tagsByCategory}
          onClose={() => setShowTagManager(false)}
        />
      )}

      {showGenerateModal && generateModalCharacterId && characters && (
        <GenerateReferenceModal
          characterId={generateModalCharacterId}
          characters={characters}
          generateOptions={generateOptions}
          onOptionsChange={setGenerateOptions}
          currentImageIndex={currentImageIndices[generateModalCharacterId] || 0}
          onClose={closeGenerateModal}
          onGenerate={handleGenerate}
          generatePending={generateMutation.isPending}
          onGenerateThreeViews={() =>
            generateThreeViewsMutation.mutate({
              id: generateModalCharacterId,
              imageConfigId: generateOptions.imageConfigId,
            })
          }
          threeViewsPending={generateThreeViewsMutation.isPending}
        />
      )}

      {/* 多候选画廊（批次 2 · 1.4B）：≥2 张时点选一张入库 */}
      {candidateGallery && (
        <ReferenceCandidateGallery
          candidates={candidateGallery.candidates}
          selectingUrl={selectingUrl}
          onSelect={(imageUrl) => {
            setSelectingUrl(imageUrl);
            selectMutation.mutate({
              id: candidateGallery.characterId,
              imageUrl,
            });
          }}
          onClose={() => setCandidateGallery(null)}
        />
      )}
    </div>
  );
}
