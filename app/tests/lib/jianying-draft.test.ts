import { describe, it, expect } from "vitest";

import {
  buildJianyingDraft,
  buildDraftMaterialPath,
  buildDraftMetaInfo,
  secondsToMicros,
  MICROS_PER_SECOND,
  PHOTO_MATERIAL_DURATION_US,
  type DraftTimelineInput,
} from "@/lib/jianying-draft";

/** 构造一个覆盖 4 类轨道的最小时间轴（视频 + 图片 + 配音 + BGM + 字幕） */
function makeInput(
  overrides: Partial<DraftTimelineInput> = {}
): DraftTimelineInput {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    pathPlaceholderUuid: "0E685133-18CE-45ED-8CB8-2904A212EC80",
    videoShots: [
      {
        kind: "video",
        materialFileName: "shot_1.mp4",
        materialWidth: 1080,
        materialHeight: 1920,
        materialDurationUs: secondsToMicros(2),
        startUs: 0,
        durationUs: secondsToMicros(3), // 镜头 3s，素材实长 2s → source 取 2s
      },
      {
        kind: "photo",
        materialFileName: "shot_2.jpg",
        materialWidth: 1080,
        materialHeight: 1920,
        materialDurationUs: PHOTO_MATERIAL_DURATION_US,
        startUs: secondsToMicros(3),
        durationUs: secondsToMicros(4),
      },
    ],
    voiceClips: [
      {
        materialFileName: "voice_1.mp3",
        materialDurationUs: secondsToMicros(2.5),
        startUs: 0,
        durationUs: secondsToMicros(3),
      },
    ],
    bgm: {
      materialFileName: "bgm.mp3",
      materialDurationUs: secondsToMicros(5),
      totalDurationUs: secondsToMicros(7),
      volume: 0.25,
    },
    subtitles: [
      { text: "你好，世界。", startUs: 0, durationUs: secondsToMicros(1.5) },
      {
        text: "第二句字幕。",
        startUs: secondsToMicros(1.5),
        durationUs: secondsToMicros(1.5),
      },
    ],
    ...overrides,
  };
}

describe("secondsToMicros", () => {
  it("按 1e6 换算并四舍五入", () => {
    expect(secondsToMicros(1)).toBe(1_000_000);
    expect(secondsToMicros(2.5)).toBe(2_500_000);
    expect(secondsToMicros(1.0000004)).toBe(1_000_000); // round
    expect(MICROS_PER_SECOND).toBe(1_000_000);
  });
});

describe("buildDraftMaterialPath", () => {
  it("拼出自包含占位符路径（token + material/ 子目录）", () => {
    expect(buildDraftMaterialPath("ABC-123", "a.mp4")).toBe(
      "##_draftpath_placeholder_ABC-123_##/material/a.mp4"
    );
  });
});

describe("buildJianyingDraft — 顶层与画布", () => {
  it("覆盖 canvas/fps，保留模板版本号", () => {
    const draft = buildJianyingDraft(makeInput());
    expect(draft.canvas_config).toEqual({
      width: 1080,
      height: 1920,
      ratio: "original",
    });
    expect(draft.fps).toBe(30);
    // 模板字段保留
    expect(draft.version).toBe(360000);
    expect((draft.platform as Record<string, unknown>).app_version).toBe(
      "5.9.0"
    );
    // 顶层 id 覆盖为唯一 UUID（非模板占位）
    expect(draft.id).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  it("duration = 所有片段 end 的最大值（BGM 铺到 7s 全片）", () => {
    const draft = buildJianyingDraft(makeInput());
    // 视频轨末镜 end = 3+4 = 7s；BGM end = 5s（实长）；配音 end=2.5s；字幕 end=3s
    expect(draft.duration).toBe(secondsToMicros(7));
  });
});

describe("buildJianyingDraft — 四轨结构", () => {
  it("四条轨道，两条 audio 轨 name 不同，导出序即 render_index", () => {
    const draft = buildJianyingDraft(makeInput());
    expect(draft.tracks).toHaveLength(4);
    expect(draft.tracks.map((t) => t.type)).toEqual([
      "video",
      "audio",
      "audio",
      "text",
    ]);
    const audioNames = draft.tracks
      .filter((t) => t.type === "audio")
      .map((t) => t.name);
    expect(new Set(audioNames).size).toBe(2); // 两条 audio 轨名唯一

    // 每个 segment 的 render_index = 轨道导出序
    draft.tracks.forEach((track, idx) => {
      track.segments.forEach((seg) => {
        expect(seg.render_index).toBe(idx);
        expect(seg.track_render_index).toBe(0);
      });
    });
  });
});

describe("buildJianyingDraft — 视频/图片素材与片段", () => {
  it("视频镜 source.duration = min(素材实长, 镜头时长)，不超素材时长", () => {
    const draft = buildJianyingDraft(makeInput());
    const videoTrack = draft.tracks[0];
    const shot1 = videoTrack.segments[0];
    const source = shot1.source_timerange as {
      start: number;
      duration: number;
    };
    const target = shot1.target_timerange as {
      start: number;
      duration: number;
    };
    // 镜头 3s，素材 2s → source 取 2s，target 保持 3s
    expect(source.start).toBe(0);
    expect(source.duration).toBe(secondsToMicros(2));
    expect(target.duration).toBe(secondsToMicros(3));
    // source.end 不超素材时长
    expect(source.start + source.duration).toBeLessThanOrEqual(
      secondsToMicros(2)
    );
    // 短视频铺满镜头：speed = source/target = 2/3（慢放拉伸，与参考库一致）
    expect(shot1.speed).toBeCloseTo(2 / 3, 6);
    // 视频片段带 hdr_settings
    expect(shot1.hdr_settings).toEqual({ intensity: 1.0, mode: 1, nits: 1000 });
  });

  it("图片素材 duration=3h，type=photo", () => {
    const draft = buildJianyingDraft(makeInput());
    const photoMat = (draft.materials.videos as Record<string, unknown>[]).find(
      (m) => m.type === "photo"
    );
    expect(photoMat).toBeDefined();
    expect(photoMat!.duration).toBe(PHOTO_MATERIAL_DURATION_US);
  });

  it("素材路径使用自包含占位符 token", () => {
    const draft = buildJianyingDraft(makeInput());
    for (const mat of draft.materials.videos as Record<string, unknown>[]) {
      expect(String(mat.path)).toContain("##_draftpath_placeholder_");
      expect(String(mat.path)).toContain("/material/");
    }
  });
});

describe("buildJianyingDraft — 素材去重", () => {
  it("同一 fileName 多镜 → materials 一条 + 多 segment 共享 material_id", () => {
    const input = makeInput({
      videoShots: [
        {
          kind: "video",
          materialFileName: "same.mp4",
          materialWidth: 1080,
          materialHeight: 1920,
          materialDurationUs: secondsToMicros(5),
          startUs: 0,
          durationUs: secondsToMicros(2),
        },
        {
          kind: "video",
          materialFileName: "same.mp4",
          materialWidth: 1080,
          materialHeight: 1920,
          materialDurationUs: secondsToMicros(5),
          startUs: secondsToMicros(2),
          durationUs: secondsToMicros(2),
        },
      ],
    });
    const draft = buildJianyingDraft(input);
    const videos = draft.materials.videos as Record<string, unknown>[];
    expect(videos).toHaveLength(1); // 去重
    const videoTrack = draft.tracks[0];
    const ids = videoTrack.segments.map((s) => s.material_id);
    expect(ids[0]).toBe(ids[1]); // 两段共享素材 id
    expect(ids[0]).toBe(videos[0].id);
  });
});

describe("buildJianyingDraft — Speed 素材", () => {
  it("每个媒体片段带一个 Speed，进 materials.speeds 且 extra_material_refs[0]=speed.id", () => {
    const draft = buildJianyingDraft(makeInput());
    const speeds = draft.materials.speeds as Record<string, unknown>[];
    // 2 视频 + 1 配音 + 1 BGM = 4 个 speed（字幕文本无 speed 素材加入 speeds）
    expect(speeds).toHaveLength(4);

    // 收集所有媒体片段的首个 extra_material_ref，应命中某个 speed id
    const speedIds = new Set(speeds.map((s) => s.id));
    const mediaSegments = [
      ...draft.tracks[0].segments, // 视频
      ...draft.tracks[1].segments, // 配音
      ...draft.tracks[2].segments, // BGM
    ];
    for (const seg of mediaSegments) {
      const refs = seg.extra_material_refs as string[];
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(speedIds.has(refs[0])).toBe(true);
    }
    // Speed 结构（图片镜 speed=1，短视频镜 speed<1；此处只校验结构键）
    expect(speeds[0]).toMatchObject({ mode: 0, type: "speed" });
    expect(typeof speeds[0].speed).toBe("number");
  });
});

describe("buildJianyingDraft — 字幕文本", () => {
  it("TextSegment.material_id 命中 materials.texts；content 可解析 JSON、range=[0,len]", () => {
    const draft = buildJianyingDraft(makeInput());
    const texts = draft.materials.texts as Record<string, unknown>[];
    expect(texts).toHaveLength(2);

    const textTrack = draft.tracks[3];
    expect(textTrack.type).toBe("text");
    expect(textTrack.segments).toHaveLength(2);

    for (const seg of textTrack.segments) {
      const mat = texts.find((t) => t.id === seg.material_id);
      expect(mat).toBeDefined();
      // content 是 JSON-in-JSON 字符串
      const parsed = JSON.parse(String(mat!.content)) as {
        styles: Array<{ range: number[]; fill: unknown }>;
        text: string;
      };
      expect(parsed.styles[0].range).toEqual([0, parsed.text.length]);
      expect(mat!.type).toBe("subtitle");
    }
  });
});

describe("buildJianyingDraft — BGM", () => {
  it("BGM source.duration = min(BGM实长, 全片总时长)", () => {
    const draft = buildJianyingDraft(makeInput());
    const bgmTrack = draft.tracks[2];
    expect(bgmTrack.segments).toHaveLength(1);
    const seg = bgmTrack.segments[0];
    const source = seg.source_timerange as { start: number; duration: number };
    // BGM 实长 5s < 全片 7s → source 取 5s
    expect(source.duration).toBe(secondsToMicros(5));
    expect(seg.volume).toBe(0.25);
    expect(seg.clip).toBeNull();
    expect(seg.hdr_settings).toBeNull();
  });

  it("无 BGM 时 BGM 轨为空且不报错", () => {
    const draft = buildJianyingDraft(makeInput({ bgm: undefined }));
    expect(draft.tracks[2].segments).toHaveLength(0);
    // speeds 少一个（3 个：2 视频 + 1 配音）
    expect((draft.materials.speeds as unknown[]).length).toBe(3);
  });
});

describe("buildJianyingDraft — materials 类目完整性", () => {
  it("所有类目键都存在（哪怕空数组）", () => {
    const draft = buildJianyingDraft(makeInput());
    const requiredKeys = [
      "audios",
      "videos",
      "texts",
      "speeds",
      "audio_fades",
      "material_animations",
      "transitions",
      "effects",
      "masks",
      "stickers",
      "canvases",
      "chromas",
    ];
    for (const key of requiredKeys) {
      expect(Array.isArray(draft.materials[key])).toBe(true);
    }
  });
});

describe("buildDraftMetaInfo", () => {
  it("draft_name = 项目名，路径字段留空，draft_id 唯一", () => {
    const meta = buildDraftMetaInfo("我的漫剧");
    expect(meta.draft_name).toBe("我的漫剧");
    expect(meta.draft_fold_path).toBe("");
    expect(meta.draft_root_path).toBe("");
    expect(typeof meta.draft_id).toBe("string");
    expect((meta.draft_materials as unknown[]).length).toBe(7);
  });
});

describe("buildJianyingDraft — 时间轴用实测时长（A1 变速一致性）", () => {
  it("durationUs = 素材实长时 speed 归 1（原速播放，不慢放拉伸）", () => {
    // 服务层按「ffprobe 实长即分镜时长」把 durationUs 取为实测值 → source==target
    const input = makeInput({
      videoShots: [
        {
          kind: "video",
          materialFileName: "real.mp4",
          materialWidth: 1080,
          materialHeight: 1920,
          materialDurationUs: secondsToMicros(2.4),
          startUs: 0,
          durationUs: secondsToMicros(2.4), // 实长即时间轴时长
        },
      ],
      voiceClips: [],
      bgm: undefined,
      subtitles: [],
    });
    const draft = buildJianyingDraft(input);
    const seg = draft.tracks[0].segments[0];
    const source = seg.source_timerange as { start: number; duration: number };
    const target = seg.target_timerange as { start: number; duration: number };
    expect(source.duration).toBe(secondsToMicros(2.4));
    expect(target.duration).toBe(secondsToMicros(2.4));
    // 不变式 source = target × speed 下 speed 恰为 1
    expect(seg.speed).toBe(1);
    // speed 素材与片段 speed 同值
    const speeds = draft.materials.speeds as Record<string, unknown>[];
    expect(speeds[0].speed).toBe(1);
    // 全片时长 = 实测时长
    expect(draft.duration).toBe(secondsToMicros(2.4));
  });

  it("探测失败回退声明值且声明值 > 实长 → 仍走慢放兜底（不破坏剪映时间不变式）", () => {
    const input = makeInput({
      videoShots: [
        {
          kind: "video",
          materialFileName: "fallback.mp4",
          materialWidth: 1080,
          materialHeight: 1920,
          materialDurationUs: secondsToMicros(2),
          startUs: 0,
          durationUs: secondsToMicros(4), // 回退声明值
        },
      ],
      voiceClips: [],
      bgm: undefined,
      subtitles: [],
    });
    const draft = buildJianyingDraft(input);
    const seg = draft.tracks[0].segments[0];
    const source = seg.source_timerange as { start: number; duration: number };
    const target = seg.target_timerange as { start: number; duration: number };
    // 不变式：source = target × speed
    expect(source.duration).toBeCloseTo(
      target.duration * (seg.speed as number),
      0
    );
    expect(seg.speed).toBeCloseTo(0.5, 6);
  });
});
