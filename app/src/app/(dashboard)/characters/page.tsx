"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Settings } from "lucide-react";
import type { CharacterListItem, Tag } from "@/types";
import {
  toAppearanceFormData,
  isAppearanceEmpty,
} from "@/components/appearance-editor";
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  generateReference,
  generateThreeViews,
  fetchTags,
  generateDescription,
  type CharacterFormData,
  type GenerateOptions,
} from "./components/constants";
import { SearchAndFilter } from "./components/SearchAndFilter";
import { CharacterCard } from "./components/CharacterCard";
import { CreateCharacterModal } from "./components/CreateCharacterModal";
import { TagManagerModal } from "./components/TagManagerModal";
import { GenerateReferenceModal } from "./components/GenerateReferenceModal";
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
  });

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

  const handleNextImage = (characterId: string, totalImages: number) => {
    setCurrentImageIndices((prev) => ({
      ...prev,
      [characterId]: ((prev[characterId] || 0) + 1) % totalImages,
    }));
  };

  const handlePrevImage = (characterId: string, totalImages: number) => {
    setCurrentImageIndices((prev) => ({
      ...prev,
      [characterId]: ((prev[characterId] || 0) - 1 + totalImages) % totalImages,
    }));
  };

  const handleDeleteImage = async (characterId: string, imageIndex: number) => {
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
      console.error("Delete image error:", error);
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const openGenerateModal = (
    characterId: string,
    defaultSource: "none" | "upload" | "existing" = "none"
  ) => {
    setGenerateModalCharacterId(characterId);
    setGenerateOptions({
      source: defaultSource,
      customPrompt: "",
      uploadedImage: null,
      imageConfigId: undefined,
    });
    setShowGenerateModal(true);
  };

  const closeGenerateModal = () => {
    setShowGenerateModal(false);
    setGenerateModalCharacterId(null);
    setGenerateOptions({
      source: "none",
      customPrompt: "",
      uploadedImage: null,
      imageConfigId: undefined,
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
    generateMutation.mutate({ id: generateModalCharacterId, options });
    closeGenerateModal();
  };

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: fetchTags,
  });

  const tagsByCategory = tags.reduce(
    (acc, tag) => {
      const category = tag.category || "other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(tag);
      return acc;
    },
    {} as Record<string, Tag[]>
  );

  const getQueryParams = () => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (selectedTagIds.length > 0) params.set("tags", selectedTagIds.join(","));
    return params.toString();
  };

  const { data: characters, isLoading } = useQuery<CharacterListItem[]>({
    queryKey: ["characters", searchQuery, selectedTagIds],
    queryFn: async () => {
      const params = getQueryParams();
      const res = await fetch(`/api/characters${params ? `?${params}` : ""}`);
      if (!res.ok) {
        if (res.status === 401) return [];
        throw new Error("Failed to fetch characters");
      }
      return res.json();
    },
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

  const createMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setShowCreateModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
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
      };
    }) => generateReference(id, options || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "生成参考图失败");
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
      toast.error(error instanceof Error ? error.message : "生成三视图失败");
    },
  });

  const generateDescriptionMutation = useMutation({
    mutationFn: generateDescription,
    onSuccess: (data) => {
      setFormData((prev) => ({ ...prev, description: data.description }));
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

  const handleDelete = async (id: string) => {
    const ok = await toast.confirm("确定要删除这个角色吗？");
    if (ok) {
      deleteMutation.mutate(id);
    }
  };

  const startEdit = (character: CharacterListItem) => {
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
  };

  const handleUpdate = () => {
    if (!editingId || !formData.name.trim()) return;
    const payload = {
      ...formData,
      appearance: isAppearanceEmpty(formData.appearance)
        ? null
        : formData.appearance,
    };
    updateMutation.mutate({ id: editingId, data: payload });
  };

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

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="text-muted-foreground animate-spin" />
        </div>
      )}

      {!isLoading && characters?.length === 0 && (
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

      {!isLoading && characters && characters.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              isEditing={editingId === character.id}
              formData={formData}
              onFormDataChange={setFormData}
              showAppearanceEditor={showAppearanceEditor}
              onToggleAppearanceEditor={() =>
                setShowAppearanceEditor((v) => !v)
              }
              tags={tags}
              currentImageIndex={currentImageIndices[character.id] || 0}
              onNextImage={handleNextImage}
              onPrevImage={handlePrevImage}
              onDeleteImage={handleDeleteImage}
              onStartEdit={startEdit}
              onCancelEdit={() => setEditingId(null)}
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
    </div>
  );
}
