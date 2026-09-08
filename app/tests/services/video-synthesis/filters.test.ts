/**
 * video-synthesis 拆分出的纯函数构建器单测。
 *
 * 覆盖四组关键契约（拆分前这些逻辑埋在 2700 行主文件里，无法直接测）：
 *   1. Ken Burns 在 speed=1 与 speed≠1 下的 zoompan 表达式；
 *   2. atempo 链在 speed>2 / speed<0.5 时的级联拆分；
 *   3. hexToAssColor 的 BGR 字节序；
 *   4. 终混音链在有/无 BGM、有/无 SFX 组合下的滤镜与输出标签。
 */

import { describe, it, expect } from "vitest";
import {
  buildKenBurnsFilter,
  buildClipVideoFilter,
} from "@/services/video-synthesis/filters/motion";
import {
  buildAtempoChain,
  buildFinalAudioChain,
} from "@/services/video-synthesis/filters/audio";
import { hexToAssColor } from "@/services/video-synthesis/ass/builder";
import { KEN_BURNS_PARAMS, CLIP_FPS } from "@/lib/impact-effect-params";
import type { BackgroundMusic } from "@/types/export-style";

describe("buildKenBurnsFilter", () => {
  it("zoomIn 从 1 线性推到 maxScale，画面居中，帧数 = 时长 × fps", () => {
    const filter = buildKenBurnsFilter(1080, 1920, "zoomIn", 4);
    const d = Math.round(4 * KEN_BURNS_PARAMS.fps);
    // 上采样到画面 2 倍供 zoompan 采样
    expect(filter).toContain("scale=2160:3840");
    expect(filter).toContain(`d=${d}`);
    expect(filter).toContain("s=1080x1920");
    expect(filter).toContain(`fps=${KEN_BURNS_PARAMS.fps}`);
    // z 从 1 递增；进度分母为 d-1
    expect(filter).toContain(
      `z='1+(${KEN_BURNS_PARAMS.maxScale}-1)*(on/${d - 1})'`
    );
    // 居中采样窗
    expect(filter).toContain("x='(iw-iw/zoom)/2'");
    expect(filter).toContain("y='(ih-ih/zoom)/2'");
  });

  it("zoomOut 从 maxScale 线性回到 1", () => {
    const filter = buildKenBurnsFilter(1080, 1920, "zoomOut", 2);
    const d = Math.round(2 * KEN_BURNS_PARAMS.fps);
    expect(filter).toContain(
      `z='${KEN_BURNS_PARAMS.maxScale}-(${KEN_BURNS_PARAMS.maxScale}-1)*(on/${d - 1})'`
    );
  });

  it("panLeft/panRight z 固定放大，x 反向平移", () => {
    const left = buildKenBurnsFilter(1080, 1920, "panLeft", 2);
    const right = buildKenBurnsFilter(1080, 1920, "panRight", 2);
    const d = Math.round(2 * KEN_BURNS_PARAMS.fps);
    expect(left).toContain(`z='${KEN_BURNS_PARAMS.maxScale}'`);
    expect(left).toContain(`x='(iw-iw/zoom)*(1-(on/${d - 1}))'`);
    expect(right).toContain(`x='(iw-iw/zoom)*(on/${d - 1})'`);
  });

  it("时长过短导致 d=1 时，进度分母退化为 1 防除零", () => {
    const filter = buildKenBurnsFilter(1080, 1920, "zoomIn", 0);
    expect(filter).toContain("d=1");
    expect(filter).toContain("(on/1)");
  });

  it("speed=1 时片段链不挂 setpts；speed≠1 时 Ken Burns 表达式不变、仅追加 setpts", () => {
    const base = { isImage: true, motion: "zoomIn" as const, impact: null };
    // 图片分支实际传入的 durationSec 已是成片轴有效时长（duration/speed）
    const at1 = buildClipVideoFilter(1080, 1920, null, 1, {
      ...base,
      durationSec: 4,
    });
    const at2 = buildClipVideoFilter(1080, 1920, null, 2, {
      ...base,
      durationSec: 4,
    });

    expect(at1).not.toContain("setpts");
    expect(at2).toContain("setpts=PTS/2.0000");

    // 两者的 zoompan 段完全相同：Ken Burns 只吃 durationSec，不吃 speed
    const kenBurns = buildKenBurnsFilter(1080, 1920, "zoomIn", 4);
    expect(at1).toContain(kenBurns);
    expect(at2).toContain(kenBurns);

    // 帧率归一恒挂链尾
    expect(at1.endsWith(`fps=${CLIP_FPS}`)).toBe(true);
    expect(at2.endsWith(`fps=${CLIP_FPS}`)).toBe(true);
  });

  it("非图片分镜（或显式关运镜）走 scale+pad，不走 Ken Burns", () => {
    const video = buildClipVideoFilter(1080, 1920, null, 1, {
      isImage: false,
      motion: null,
      impact: null,
      durationSec: 4,
    });
    expect(video).toContain(
      "scale=1080:1920:force_original_aspect_ratio=decrease"
    );
    expect(video).toContain("pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black");
    expect(video).not.toContain("zoompan");
  });
});

describe("buildAtempoChain", () => {
  it("speed=1 时无需变速，返回空链", () => {
    expect(buildAtempoChain(1)).toEqual([]);
  });

  it("0.5–2.0 区间内单段直出", () => {
    expect(buildAtempoChain(1.5)).toEqual(["atempo=1.5000"]);
    expect(buildAtempoChain(0.75)).toEqual(["atempo=0.7500"]);
  });

  it("speed>2 时级联拆分，各段乘积等于目标倍率", () => {
    // 3 = 2.0 × 1.5
    expect(buildAtempoChain(3)).toEqual(["atempo=2.0", "atempo=1.5000"]);
    // 4 = 2.0 × 2.0：while 条件 s>2.0 是严格大于，s 减到 2.0 即退出，
    // 余下的 2.0 由尾段输出（故为 atempo=2.0000 而非再走一次循环）
    expect(buildAtempoChain(4)).toEqual(["atempo=2.0", "atempo=2.0000"]);

    const product = buildAtempoChain(3).reduce(
      (acc, p) => acc * Number(p.split("=")[1]),
      1
    );
    expect(product).toBeCloseTo(3, 3);
  });

  it("speed<0.5 时级联拆分，各段乘积等于目标倍率", () => {
    // 0.25 = 0.5 × 0.5：while 条件 s<0.5 是严格小于，s 升到 0.5 即退出，
    // 余下的 0.5 由尾段输出（与 speed>2 分支对称）
    expect(buildAtempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5000"]);
    // 0.3 = 0.5 × 0.6
    expect(buildAtempoChain(0.3)).toEqual(["atempo=0.5", "atempo=0.6000"]);

    const product = buildAtempoChain(0.3).reduce(
      (acc, p) => acc * Number(p.split("=")[1]),
      1
    );
    expect(product).toBeCloseTo(0.3, 3);
  });

  it("每段都落在 ffmpeg 允许的 0.5–2.0 区间内", () => {
    for (const speed of [0.25, 0.3, 0.4, 3, 4, 4.5]) {
      for (const part of buildAtempoChain(speed)) {
        const value = Number(part.split("=")[1]);
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(2.0);
      }
    }
  });
});

describe("hexToAssColor", () => {
  it("按 BGR 字节序重排（与 HTML 的 RGB 相反）", () => {
    // #RRGGBB=#112233 → &H00 + BB(33) + GG(22) + RR(11)
    expect(hexToAssColor("#112233")).toBe("&H00332211");
  });

  it("纯红/纯蓝可验证字节序未被写反", () => {
    // 纯红 R=FF 落在最低位
    expect(hexToAssColor("#FF0000")).toBe("&H000000FF");
    // 纯蓝 B=FF 落在最高有效位
    expect(hexToAssColor("#0000FF")).toBe("&H00FF0000");
    // 纯绿位置不变（中间字节）
    expect(hexToAssColor("#00FF00")).toBe("&H0000FF00");
  });

  it("alpha 恒为 00（不透明），输出统一大写，# 号可省略", () => {
    expect(hexToAssColor("#ffffff")).toBe("&H00FFFFFF");
    expect(hexToAssColor("ffffff")).toBe("&H00FFFFFF");
    expect(hexToAssColor("#000000")).toBe("&H00000000");
  });
});

describe("buildFinalAudioChain", () => {
  const bgm: BackgroundMusic = {
    enabled: true,
    url: "/bgm/test.mp3",
    volume: 0.25,
    loop: true,
    fadeIn: 1.5,
    fadeOut: 2,
    ducking: false,
  };

  it("完全无音频时返回 null（调用方不 map 音频）", () => {
    expect(
      buildFinalAudioChain({
        voiceLabels: [],
        bgm: null,
        bgmInputIndex: -1,
        bgmTotalDuration: 0,
        sfxLabels: [],
      })
    ).toBeNull();
  });

  it("仅对白：amix 必须带 normalize=0（防逐镜音量漂移），末尾 loudnorm", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: ["[a0]", "[a1]"],
      bgm: null,
      bgmInputIndex: -1,
      bgmTotalDuration: 0,
      sfxLabels: [],
    });
    expect(chain).not.toBeNull();
    const joined = chain!.filters.join(";");
    expect(joined).toContain("[a0][a1]amix=inputs=2:normalize=0[voicemix]");
    expect(joined).toContain(
      "[voicemix]loudnorm=I=-16:TP=-1.5:LRA=11[amaster]"
    );
    expect(chain!.outLabel).toBe("[amaster]");
    // 无 BGM 时不应出现 BGM 处理链
    expect(joined).not.toContain("[bgmout]");
  });

  it("对白 + BGM：BGM 走 volume/aloop/atrim/afade，且以 0.6 权重混入", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: ["[a0]"],
      bgm,
      bgmInputIndex: 2,
      bgmTotalDuration: 30,
      sfxLabels: [],
    });
    const joined = chain!.filters.join(";");
    expect(joined).toContain("[2:a]volume=0.250");
    expect(joined).toContain("aloop=loop=-1");
    expect(joined).toContain("atrim=0:30.000");
    expect(joined).toContain("afade=t=in:st=0:d=1.500");
    // fadeOut 起点 = 总时长 - fadeOut
    expect(joined).toContain("afade=t=out:st=28.000:d=2.000");
    // 对白权重 1、BGM 0.6
    expect(joined).toContain("weights='1 0.6'");
    expect(chain!.outLabel).toBe("[amaster]");
  });

  it("BGM ducking 走 sidechaincompress 闪避而非权重", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: ["[a0]"],
      bgm: { ...bgm, ducking: true },
      bgmInputIndex: 1,
      bgmTotalDuration: 10,
      sfxLabels: [],
    });
    const joined = chain!.filters.join(";");
    expect(joined).toContain("sidechaincompress");
    expect(joined).toContain("[bgmducked]");
    expect(joined).not.toContain("weights=");
  });

  it("无对白有 BGM：BGM 即唯一音轨，直接进 loudnorm", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: [],
      bgm,
      bgmInputIndex: 1,
      bgmTotalDuration: 12,
      sfxLabels: [],
    });
    const joined = chain!.filters.join(";");
    expect(joined).toContain("[bgmout]loudnorm=I=-16:TP=-1.5:LRA=11[amaster]");
    expect(joined).not.toContain("amix");
  });

  it("对白 + SFX（无 BGM）：SFX 以 0.9 权重叠在基轨之上", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: ["[a0]"],
      bgm: null,
      bgmInputIndex: -1,
      bgmTotalDuration: 0,
      sfxLabels: ["[sfx0]", "[sfx1]"],
    });
    const joined = chain!.filters.join(";");
    expect(joined).toContain("[voicemix][sfx0][sfx1]amix=inputs=3:normalize=0");
    expect(joined).toContain("weights='1 0.9 0.9'");
    expect(joined).toContain(
      "[premaster]loudnorm=I=-16:TP=-1.5:LRA=11[amaster]"
    );
  });

  it("对白 + BGM + SFX 三层齐备：BGM 先入基轨，SFX 再叠加", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: ["[a0]"],
      bgm,
      bgmInputIndex: 2,
      bgmTotalDuration: 20,
      sfxLabels: ["[sfx0]"],
    });
    const joined = chain!.filters.join(";");
    expect(joined).toContain("[bgmout]");
    // 基轨 [aout]（对白+BGM）与 SFX 再混
    expect(joined).toContain("[aout][sfx0]amix=inputs=2:normalize=0");
    expect(joined).toContain("weights='1 0.9'");
    expect(chain!.outLabel).toBe("[amaster]");
  });

  it("纯单条 SFX（无对白无 BGM）不多余 amix，直接 loudnorm", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: [],
      bgm: null,
      bgmInputIndex: -1,
      bgmTotalDuration: 0,
      sfxLabels: ["[sfx0]"],
    });
    expect(chain!.filters).toEqual([
      "[sfx0]loudnorm=I=-16:TP=-1.5:LRA=11[amaster]",
    ]);
  });

  it("bgmInputIndex 为 -1 时视为无 BGM（下载失败的降级路径）", () => {
    const chain = buildFinalAudioChain({
      voiceLabels: ["[a0]"],
      bgm,
      bgmInputIndex: -1,
      bgmTotalDuration: 20,
      sfxLabels: [],
    });
    const joined = chain!.filters.join(";");
    expect(joined).not.toContain("[bgmout]");
    expect(joined).toContain("[voicemix]");
  });
});
