import { describe, it, expect } from "vitest";
import {
  buildBgmFilter,
  buildSfxFilters,
  buildSfxSchedule,
  AMBIENT_DEFAULT_VOLUME,
  type BgmSegmentInput,
} from "@/services/video-synthesis/filters/audio";
import { BGM_CROSSFADE_SEC } from "@/lib/bgm-segments";
import { DEFAULT_BACKGROUND_MUSIC } from "@/types/export-style";

const BGM = { ...DEFAULT_BACKGROUND_MUSIC, enabled: true, url: "/bgm/x.mp3" };

/**
 * 「段生产行」判据：形如 `[N:a]...[bgmsegK]`，以输入标签开头。
 * acrossfade 串联行以 `[bgmseg` 开头（消费段标签），必须排除，
 * 否则断言会落到串联行上而非真正的处理链。
 */
function isSegmentLine(f: string): boolean {
  return /^\[\d+:a\]/.test(f) && f.includes("[bgmseg");
}

/** 从 atrim=0:N 取出 N（滤镜串里逐段的截断长度） */
function trimLengths(filters: string[]): number[] {
  return filters
    .filter(isSegmentLine)
    .map((f) => Number(/atrim=0:([\d.]+)/.exec(f)![1]));
}

describe("buildBgmFilter — 单曲路径（向后兼容）", () => {
  it("不传 segments 时行为与原单曲路径一致（aloop+atrim 到全片时长）", () => {
    const { filters, outLabel } = buildBgmFilter(BGM, 3, 30, []);
    expect(outLabel).toBe("[bgmout]");
    expect(filters[0]).toContain("[3:a]");
    expect(filters[0]).toContain("aloop=loop=-1:size=2000000000");
    expect(filters[0]).toContain("atrim=0:30.000");
    expect(filters[0]).not.toContain("acrossfade");
  });

  it("单段（length<2）也走单曲路径，不产生 acrossfade", () => {
    const segs: BgmSegmentInput[] = [
      { inputIndex: 3, startSec: 0, endSec: 30 },
    ];
    const { filters } = buildBgmFilter(BGM, 3, 30, [], segs);
    expect(filters.join(";")).not.toContain("acrossfade");
  });

  it("ducking 缺省即开（`!== false`）在分段路径下同样生效", () => {
    const segs: BgmSegmentInput[] = [
      { inputIndex: 1, startSec: 0, endSec: 15 },
      { inputIndex: 2, startSec: 15, endSec: 30 },
    ];
    const { filters, outLabel } = buildBgmFilter(
      { ...BGM, ducking: undefined as unknown as boolean },
      -1,
      30,
      ["[a0]"],
      segs
    );
    expect(filters.join(";")).toContain("sidechaincompress");
    expect(outLabel).toBe("[aout]");
  });
});

describe("buildBgmFilter — 分段路径（acrossfade 串联）", () => {
  const segs: BgmSegmentInput[] = [
    { inputIndex: 1, startSec: 0, endSec: 12 },
    { inputIndex: 2, startSec: 12, endSec: 23 },
    { inputIndex: 3, startSec: 23, endSec: 35 },
  ];

  it("每段一个输入，产出单条 [bgmout]", () => {
    const { filters, outLabel } = buildBgmFilter(BGM, -1, 35, [], segs);
    expect(outLabel).toBe("[bgmout]");
    expect(filters.filter(isSegmentLine)).toHaveLength(3);
    expect(filters.filter((f) => f.includes("acrossfade"))).toHaveLength(2);
    expect(filters[filters.length - 1]).toContain("[bgmout]");
  });

  it("非末段 atrim 补偿 +d，末段不补——保证串联后总长 = 成片时长", () => {
    const { filters } = buildBgmFilter(BGM, -1, 35, [], segs);
    const trims = trimLengths(filters);
    const d = BGM_CROSSFADE_SEC;
    // 名义段长 12 / 11 / 12
    expect(trims).toEqual([12 + d, 11 + d, 12]);
    // acrossfade 每次吃掉 d：总长 = Σtrim - d*(段数-1)
    const total = trims.reduce((a, b) => a + b, 0) - d * (segs.length - 1);
    expect(total).toBeCloseTo(35, 6);
  });

  it("中间段不各自淡入淡出（衔接交给 acrossfade，避免断裂听感）", () => {
    const { filters } = buildBgmFilter(BGM, -1, 35, [], segs);
    const mid = filters.find(
      (f) => isSegmentLine(f) && f.includes("[bgmseg1]")
    )!;
    expect(mid).not.toContain("afade");
  });

  it("首段带全片淡入、末段带全片淡出（淡出 st 换算为段内相对秒）", () => {
    const { filters } = buildBgmFilter(BGM, -1, 35, [], segs);
    const first = filters.find(
      (f) => isSegmentLine(f) && f.includes("[bgmseg0]")
    )!;
    const last = filters.find(
      (f) => isSegmentLine(f) && f.includes("[bgmseg2]")
    )!;
    expect(first).toContain("afade=t=in:st=0:d=1.500");
    // fadeOut=2 → 全片 33s 起淡出；末段起点 23s → 段内相对 10s
    expect(last).toContain("afade=t=out:st=10.000:d=2.000");
  });

  it("每段都 aloop——短曲（如 15s）也能铺满更长的情绪段", () => {
    const { filters } = buildBgmFilter(BGM, -1, 35, [], segs);
    for (const f of filters.filter(isSegmentLine)) {
      expect(f).toContain("aloop=loop=-1:size=2000000000");
    }
  });

  it("标签不冲突：段标签 [bgmseg{i}] 与中间产物 [bgmx{i}] 互不重名", () => {
    const { filters } = buildBgmFilter(BGM, -1, 35, [], segs);
    const chain = filters.join(";");
    expect(chain).toContain("[bgmx1]");
    expect(chain).not.toContain("[bgmx2]"); // 最后一次直接输出 [bgmout]
  });

  it("音量按 bgm.volume 逐段施加（各段电平一致）", () => {
    const { filters } = buildBgmFilter(
      { ...BGM, volume: 0.4 },
      -1,
      35,
      [],
      segs
    );
    for (const f of filters.filter(isSegmentLine)) {
      expect(f).toContain("volume=0.400");
    }
  });
});

describe("ducking 链的 asplit 契约（滤镜图合法性回归）", () => {
  // ffmpeg 的滤镜图里每个标签只能被消费一次。对白既要当侧链 key 又要进终混，
  // 必须 asplit 成两路；此前复用同一个 [voice] 会让 ffmpeg 直接报
  // 「matches no streams」导致整个导出失败（有 BGM+对白+ducking 即命中）。
  const segs: BgmSegmentInput[] = [
    { inputIndex: 1, startSec: 0, endSec: 15 },
    { inputIndex: 2, startSec: 15, endSec: 30 },
  ];

  /** 统计滤镜串里每个标签被「消费」（出现在某条滤镜输入位）的次数 */
  function consumedCounts(filters: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const f of filters) {
      // 输入标签 = 该条滤镜开头连续的 [xxx]
      const head = /^((?:\[[^\]]+\])+)/.exec(f);
      if (!head) continue;
      for (const m of head[1].matchAll(/\[([^\]]+)\]/g)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      }
    }
    return counts;
  }

  it.each([
    ["单曲路径", undefined],
    ["分段路径", segs],
  ])("%s：ducking 开启时无任何标签被消费两次", (_name, s) => {
    const { filters } = buildBgmFilter(BGM, 3, 30, ["[a0]", "[a1]"], s);
    for (const [label, n] of consumedCounts(filters)) {
      expect(`${label}:${n}`).toBe(`${label}:1`);
    }
  });

  it("对白经 asplit=2 分出侧链路与干声路，二者分别只用一次", () => {
    const { filters } = buildBgmFilter(BGM, 3, 30, ["[a0]"], undefined);
    const chain = filters.join(";");
    expect(chain).toContain("asplit=2[voice][voicedry]");
    // [voice] 进侧链、[voicedry] 进终混——不得对调或复用
    expect(chain).toContain("[bgmout][voice]sidechaincompress");
    expect(chain).toContain("[voicedry][bgmducked]amix");
  });

  it("ducking 显式关闭时走权重路径，同样无标签复用", () => {
    const { filters } = buildBgmFilter(
      { ...BGM, ducking: false },
      3,
      30,
      ["[a0]", "[a1]"],
      segs
    );
    expect(filters.join(";")).not.toContain("asplit");
    for (const [label, n] of consumedCounts(filters)) {
      expect(`${label}:${n}`).toBe(`${label}:1`);
    }
  });
});

describe("buildSfxSchedule — ambient 场景级铺底", () => {
  const sceneIds = ["s0", "s1", "s2", "s3"];
  const durations = [5, 5, 5, 5];
  const starts = [0, 5, 10, 15];

  it("oneshot（缺省 mode）行为不变——点触发、无时间窗", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s1", sfxId: "glass-shatter", offsetSec: 1 }],
      starts,
      sceneIds,
      [],
      durations,
      ["家", "家", "街", "街"]
    );
    expect(items).toHaveLength(1);
    expect(items[0].triggerSec).toBe(6);
    expect(items[0].mode).toBeUndefined();
    expect(items[0].durationSec).toBeUndefined();
  });

  it("ambient 按 locationKey 合并连续同地点分镜成一个时间窗", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s0", sfxId: "ambient-rain", offsetSec: 0, mode: "ambient" }],
      starts,
      sceneIds,
      [],
      durations,
      ["家", "家", "街", "街"]
    );
    expect(items).toHaveLength(1);
    expect(items[0].mode).toBe("ambient");
    expect(items[0].triggerSec).toBe(0);
    // s0+s1 同为「家」→ 窗长 10s（换镜不断）
    expect(items[0].durationSec).toBe(10);
  });

  it("同地点多镜各标一条 ambient → 去重为一条（防 N 条雨声叠加）", () => {
    const items = buildSfxSchedule(
      [
        { sceneId: "s0", sfxId: "ambient-rain", offsetSec: 0, mode: "ambient" },
        { sceneId: "s1", sfxId: "ambient-rain", offsetSec: 0, mode: "ambient" },
      ],
      starts,
      sceneIds,
      [],
      durations,
      ["家", "家", "街", "街"]
    );
    expect(items).toHaveLength(1);
    expect(items[0].durationSec).toBe(10);
  });

  it("locationKey 为空时不跨镜合并（地点未知不盲目铺开）", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s1", sfxId: "ambient-rain", offsetSec: 0, mode: "ambient" }],
      starts,
      sceneIds,
      [],
      durations,
      [null, null, null, null]
    );
    expect(items[0].triggerSec).toBe(5);
    expect(items[0].durationSec).toBe(5); // 只覆盖本镜
  });

  it("ambient 缺省音量为 AMBIENT_DEFAULT_VOLUME（0.2，真正的底噪）", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s0", sfxId: "ambient-rain", offsetSec: 0, mode: "ambient" }],
      starts,
      sceneIds,
      [],
      durations,
      ["家", "家", "街", "街"]
    );
    expect(items[0].volume).toBe(AMBIENT_DEFAULT_VOLUME);
    expect(AMBIENT_DEFAULT_VOLUME).toBeLessThan(0.35); // 比旧值更低
  });

  it("显式 volume 优先于 ambient 缺省值", () => {
    const items = buildSfxSchedule(
      [
        {
          sceneId: "s0",
          sfxId: "ambient-rain",
          offsetSec: 0,
          mode: "ambient",
          volume: 0.5,
        },
      ],
      starts,
      sceneIds,
      [],
      durations,
      ["家", "家", "街", "街"]
    );
    expect(items[0].volume).toBe(0.5);
  });

  it("缺 sceneDurations/locationKeys 时 ambient 退化为 oneshot（老调用方不出错）", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s0", sfxId: "ambient-rain", offsetSec: 2, mode: "ambient" }],
      starts,
      sceneIds
    );
    expect(items).toHaveLength(1);
    expect(items[0].durationSec).toBeUndefined();
    expect(items[0].triggerSec).toBe(2);
  });
});

describe("buildSfxFilters — ambient 滤镜链", () => {
  it("ambient 产出 aloop+atrim+asetpts+双 afade+volume+adelay", () => {
    const { filters, labels } = buildSfxFilters(
      [
        {
          url: "/sfx/ambient/rain.mp3",
          triggerSec: 5,
          volume: 0.2,
          origin: "config",
          mode: "ambient",
          durationSec: 12,
        },
      ],
      0
    );
    expect(labels).toEqual(["[sfx0]"]);
    const f = filters[0];
    expect(f).toContain("aloop=loop=-1:size=2000000000");
    expect(f).toContain("atrim=0:12.000");
    expect(f).toContain("asetpts=N/SR/TB");
    expect(f).toContain("afade=t=in:st=0:d=0.800");
    expect(f).toContain("afade=t=out:st=11.200:d=0.800");
    expect(f).toContain("volume=0.200");
    expect(f).toContain("adelay=5000|5000");
  });

  it("oneshot 保持原有单行链（零回归）", () => {
    const { filters } = buildSfxFilters(
      [
        {
          url: "/sfx/hit.mp3",
          triggerSec: 3,
          volume: 0.7,
          origin: "config",
        },
      ],
      2
    );
    expect(filters[0]).toBe("[2:a]volume=0.700,adelay=3000|3000[sfx0]");
    expect(filters[0]).not.toContain("aloop");
  });

  it("极短窗：淡入淡出收缩到窗长 1/3，不会重叠成静音", () => {
    const { filters } = buildSfxFilters(
      [
        {
          url: "/sfx/ambient/rain.mp3",
          triggerSec: 0,
          volume: 0.2,
          origin: "config",
          mode: "ambient",
          durationSec: 1.2,
        },
      ],
      0
    );
    // fade = min(0.8, 1.2/3) = 0.4
    expect(filters[0]).toContain("afade=t=in:st=0:d=0.400");
    expect(filters[0]).toContain("afade=t=out:st=0.800:d=0.400");
  });

  it("durationSec 为 0 的 ambient 退化为 oneshot（防除零/负数窗）", () => {
    const { filters } = buildSfxFilters(
      [
        {
          url: "/sfx/ambient/rain.mp3",
          triggerSec: 1,
          volume: 0.2,
          origin: "config",
          mode: "ambient",
          durationSec: 0,
        },
      ],
      0
    );
    expect(filters[0]).not.toContain("aloop");
  });

  it("ambient 与 oneshot 混排时输入索引逐条递增", () => {
    const { filters, labels } = buildSfxFilters(
      [
        {
          url: "/a.mp3",
          triggerSec: 0,
          volume: 0.2,
          origin: "config",
          mode: "ambient",
          durationSec: 10,
        },
        { url: "/b.mp3", triggerSec: 2, volume: 0.7, origin: "config" },
      ],
      5
    );
    expect(labels).toEqual(["[sfx0]", "[sfx1]"]);
    expect(filters[0]).toContain("[5:a]");
    expect(filters[1]).toContain("[6:a]");
  });
});
