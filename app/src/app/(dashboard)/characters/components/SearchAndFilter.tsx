"use client";

import { Search } from "lucide-react";
import type { Tag } from "@/types";
import { CATEGORY_LABELS } from "./constants";

interface SearchAndFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedTagIds: string[];
  onSelectedTagIdsChange: (ids: string[]) => void;
  tagsByCategory: Record<string, Tag[]>;
}

export function SearchAndFilter({
  searchQuery,
  onSearchChange,
  selectedTagIds,
  onSelectedTagIdsChange,
  tagsByCategory,
}: SearchAndFilterProps) {
  return (
    <div className="mb-6 space-y-4">
      <div className="relative">
        <Search
          size={18}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          placeholder="搜索角色名称..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pr-4 pl-10 transition focus:border-blue-500 focus:outline-none"
        />
      </div>

      {Object.keys(tagsByCategory).length > 0 && (
        <div className="space-y-2">
          {Object.entries(tagsByCategory).map(([category, categoryTags]) => (
            <div key={category}>
              <div className="mb-1 text-xs text-gray-500">
                {CATEGORY_LABELS[category] || category}
              </div>
              <div className="flex flex-wrap gap-2">
                {categoryTags.map((tag) => {
                  const isSelected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => {
                        onSelectedTagIdsChange(
                          isSelected
                            ? selectedTagIds.filter((id) => id !== tag.id)
                            : [...selectedTagIds, tag.id]
                        );
                      }}
                      className={`rounded-full px-3 py-1 text-sm transition ${
                        isSelected
                          ? "ring-2 ring-offset-2 ring-offset-gray-900"
                          : "opacity-60 hover:opacity-100"
                      } `}
                      style={{
                        backgroundColor: isSelected
                          ? tag.color || "#6B7280"
                          : "rgba(107,114,128,0.3)",
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {(searchQuery || selectedTagIds.length > 0) && (
        <button
          onClick={() => {
            onSearchChange("");
            onSelectedTagIdsChange([]);
          }}
          className="text-sm text-gray-400 transition hover:text-white"
        >
          清除筛选
        </button>
      )}
    </div>
  );
}
