import { describe, it, expect } from "vitest";
import {
  estimateSpeechSeconds,
  computeShotDuration,
  isTrimExemptShot,
  calibrateSceneDurations,
  type CalibratableScene,
} from "@/lib/shot-timing";

describe("estimateSpeechSeconds", () => {
  it("空文本返回 0", () => {
    expect(estimateSpeechSeconds("")).toBe(0);
    expect(estimateSpeechSeconds("   ")).toBe(0);
  });

  it("中文按 2.5 字/秒", () => {
    // 10 个汉字 → 4 秒
    expect(estimateSpeechSeconds("一二三四五六七八九十")).toBeCloseTo(4, 5);
    // 5 个汉字 → 2 秒
    expect(estimateSpeechSeconds("你好世界啊")).toBeCloseTo(2, 5);
  });

  it("标点不计入朗读时长", () => {
    // 5 汉字 + 标点 → 仍是 2 秒（标点被忽略，只数「你好世界啊」5 字）
    expect(estimateSpeechSeconds("你好世界啊，！")).toBeCloseTo(2, 5);
  });

  it("英文按词数 / 2.5", () => {
    // 5 个词 → 2 秒
    expect(estimateSpeechSeconds("one two three four five")).toBeCloseTo(2, 5);
  });

  it("中英混排叠加", () => {
    // 5 汉字(2s) + 2 词(0.8s) = 2.8s
    expect(estimateSpeechSeconds("你好世界啊 hello world")).toBeCloseTo(2.8, 5);
  });
});

describe("computeShotDuration", () => {
  it("无对白空镜：按景别派生", () => {
    // 全景无对白 base=3.5 → 4（向上取整）
    expect(
      computeShotDuration({ shotType: "全景", dialogue: null, narration: null })
    ).toBe(4);
    // 特写无对白 base=2.5 → 3
    expect(
      computeShotDuration({ shotType: "特写", dialogue: null, narration: null })
    ).toBe(3);
  });

  it("快节奏情绪的空镜更短", () => {
    // 特写 base=2.5 * 0.7 = 1.75 → 2（angry 快情绪）
    expect(computeShotDuration({ shotType: "特写", emotion: "angry" })).toBe(2);
  });

  it("对白镜不短于朗读时长", () => {
    // 25 汉字 → 10 秒朗读；即使景别下限只有 1.5，也必须 >= 10
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "这是一句非常非常长的台词用来测试朗读时长的下限约束是否生效呀",
    });
    expect(d).toBeGreaterThanOrEqual(10);
  });

  it("LLM 把对白镜填太短时强制补齐", () => {
    // 10 汉字对白 → 4s 朗读；LLM 只给 1s，应被补到 >= 4
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "一二三四五六七八九十",
      llmDuration: 1,
    });
    expect(d).toBeGreaterThanOrEqual(4);
  });

  it("LLM 合理值被采信", () => {
    // 10 汉字对白 4s 下限；LLM 给 5（在 [4, 8] 内）→ 采信 5
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "一二三四五六七八九十",
      llmDuration: 5,
    });
    expect(d).toBe(5);
  });

  it("空镜被 LLM 拉太长时夹回上限", () => {
    // 无对白 LLM 给 30s（凑时长）→ 夹回软上限 8
    const d = computeShotDuration({
      shotType: "中景",
      llmDuration: 30,
    });
    expect(d).toBeLessThanOrEqual(8);
  });

  it("旁白也计入朗读下限", () => {
    // 20 汉字旁白 → 8s；无对白但旁白要念完
    const d = computeShotDuration({
      shotType: "远景",
      narration: "夜色如墨缓缓浸透了整座沉睡的孤城无人知晓那场风暴将至",
    });
    expect(d).toBeGreaterThanOrEqual(8);
  });

  it("对白 + 旁白时长叠加", () => {
    // 10 汉字对白(4s) + 10 汉字旁白(4s) = 8s 下限
    const d = computeShotDuration({
      shotType: "近景",
      dialogue: "一二三四五六七八九十",
      narration: "甲乙丙丁戊己庚辛壬癸",
    });
    expect(d).toBeGreaterThanOrEqual(8);
  });

  it("结果始终为 [1,60] 的整数", () => {
    const d = computeShotDuration({
      shotType: "特写",
      dialogue: "短",
      llmDuration: 999,
    });
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(60);
  });

  it("未知景别有兜底", () => {
    // 未知景别无对白 → base 3 → 3
    expect(computeShotDuration({ shotType: "怪景别" })).toBe(3);
    // 完全空输入 → 3
    expect(computeShotDuration({})).toBe(3);
  });
});

describe("isTrimExemptShot — 裁剪豁免（批2）", () => {
  it("快节奏情绪（angry/surprised/fear）豁免", () => {
    expect(isTrimExemptShot({ emotion: "angry" })).toBe(true);
    expect(isTrimExemptShot({ emotion: "surprised" })).toBe(true);
    expect(isTrimExemptShot({ emotion: "fear" })).toBe(true);
  });

  it("普通情绪不豁免", () => {
    expect(isTrimExemptShot({ emotion: "neutral" })).toBe(false);
    expect(isTrimExemptShot({ emotion: "sad" })).toBe(false);
    expect(isTrimExemptShot({ emotion: null })).toBe(false);
  });

  it("有非空 actionBeat 豁免（动作镜）", () => {
    expect(isTrimExemptShot({ actionBeat: "挥拳砸向敌人" })).toBe(true);
    // 空白 actionBeat 不豁免
    expect(isTrimExemptShot({ actionBeat: "   " })).toBe(false);
    expect(isTrimExemptShot({ actionBeat: null })).toBe(false);
  });

  it("长镜（目标 ≥6s）豁免", () => {
    expect(isTrimExemptShot({ targetDuration: 6 })).toBe(true);
    expect(isTrimExemptShot({ targetDuration: 12 })).toBe(true);
    expect(isTrimExemptShot({ targetDuration: 4 })).toBe(false);
    expect(isTrimExemptShot({ targetDuration: null })).toBe(false);
  });

  it("全部为常规值 → 不豁免（裁剪，恢复快节奏）", () => {
    expect(
      isTrimExemptShot({
        emotion: "neutral",
        actionBeat: null,
        targetDuration: 3,
      })
    ).toBe(false);
  });

  describe("强信号（解析层落库标注）优先于情绪启发式", () => {
    it("isClimax=true 豁免，即使其余判据全为常规值", () => {
      expect(
        isTrimExemptShot({
          emotion: "neutral",
          actionBeat: null,
          targetDuration: 3,
          isClimax: true,
        })
      ).toBe(true);
    });

    it("beatType=impact 豁免，大小写不敏感且容忍空白", () => {
      expect(isTrimExemptShot({ beatType: "impact" })).toBe(true);
      expect(isTrimExemptShot({ beatType: "IMPACT" })).toBe(true);
      expect(isTrimExemptShot({ beatType: " impact " })).toBe(true);
    });

    it("其它 beatType 不构成豁免（仍回落启发式）", () => {
      expect(isTrimExemptShot({ beatType: "setup", emotion: "neutral" })).toBe(
        false
      );
      // 非 impact 节拍但情绪快 → 启发式仍豁免
      expect(isTrimExemptShot({ beatType: "setup", emotion: "angry" })).toBe(
        true
      );
    });

    it("强信号缺失/为假时不改变原启发式结论", () => {
      expect(
        isTrimExemptShot({
          emotion: "neutral",
          targetDuration: 3,
          isClimax: false,
          beatType: null,
        })
      ).toBe(false);
    });
  });
});

describe("computeShotDuration — 全片节奏曲线", () => {
  describe("缺省参数：不传位置上下文时与改动前逐字等价（零回归）", () => {
    it("不传 sceneIndex 时不套用任何节奏系数", () => {
      // 与上方「无对白空镜」用例同输入同预期
      expect(computeShotDuration({ shotType: "全景" })).toBe(4);
      expect(computeShotDuration({ shotType: "特写" })).toBe(3);
      expect(computeShotDuration({})).toBe(3);
    });

    it("只传 isClimax/beatType 但不传 sceneIndex 时也不生效", () => {
      // 位置上下文缺席 → phase 恒为 normal，高潮压缩不触发
      expect(computeShotDuration({ shotType: "全景", isClimax: true })).toBe(4);
      expect(
        computeShotDuration({ shotType: "全景", beatType: "impact" })
      ).toBe(4);
    });
  });

  describe("开场段（前 3 镜）：快切", () => {
    it("开场无对白镜被压到远短于常规", () => {
      // 全景常规 4s；开场 3.5*0.55=1.925 → 2s
      const opening = computeShotDuration({
        shotType: "全景",
        sceneIndex: 0,
        totalScenes: 20,
      });
      const normal = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
      });
      expect(opening).toBeLessThan(normal);
      expect(opening).toBeLessThanOrEqual(2);
    });

    it("前 3 镜都属开场，第 4 镜起恢复常规", () => {
      const durations = [0, 1, 2, 3].map((i) =>
        computeShotDuration({
          shotType: "全景",
          sceneIndex: i,
          totalScenes: 20,
        })
      );
      expect(durations[0]).toBe(durations[1]);
      expect(durations[1]).toBe(durations[2]);
      // 第 4 镜（index 3）不再压缩
      expect(durations[3]).toBeGreaterThan(durations[2]);
    });

    it("开场镜突破 1.5s 的景别下限（原实现物理上做不到）", () => {
      // 特写有对白景别下限 1.5s；开场镜应能压到 1s
      const d = computeShotDuration({
        shotType: "特写",
        sceneIndex: 0,
        totalScenes: 20,
      });
      expect(d).toBeLessThanOrEqual(1);
    });

    it("开场镜有整句台词时仍不截断配音", () => {
      // 10 汉字 → 4s 朗读；开场也不得压到念不完
      const d = computeShotDuration({
        shotType: "近景",
        dialogue: "一二三四五六七八九十",
        sceneIndex: 0,
        totalScenes: 20,
      });
      expect(d).toBeGreaterThanOrEqual(4);
    });
  });

  describe("高潮段：压缩", () => {
    it("isClimax 镜短于同景别的常规镜", () => {
      const climax = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
        isClimax: true,
      });
      const normal = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
      });
      expect(climax).toBeLessThan(normal);
    });

    it("beatType=impact 与 isClimax 等效", () => {
      const byBeat = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
        beatType: "impact",
      });
      const byClimax = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
        isClimax: true,
      });
      expect(byBeat).toBe(byClimax);
    });

    it("高潮镜不截断对白", () => {
      const d = computeShotDuration({
        shotType: "近景",
        dialogue: "一二三四五六七八九十",
        sceneIndex: 10,
        totalScenes: 20,
        isClimax: true,
      });
      expect(d).toBeGreaterThanOrEqual(4);
    });

    it("非 impact 的其它节拍不触发压缩", () => {
      const d = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
        beatType: "calm",
      });
      expect(d).toBe(4);
    });
  });

  describe("结尾段：最后一镜留白", () => {
    it("末镜不短于 2.5s 硬下限", () => {
      // 特写常规 3s；末镜应被拉长且 >= 2.5
      const d = computeShotDuration({
        shotType: "特写",
        sceneIndex: 19,
        totalScenes: 20,
      });
      expect(d).toBeGreaterThanOrEqual(3);
    });

    it("末镜长于同景别常规镜", () => {
      const ending = computeShotDuration({
        shotType: "全景",
        sceneIndex: 19,
        totalScenes: 20,
      });
      const normal = computeShotDuration({
        shotType: "全景",
        sceneIndex: 10,
        totalScenes: 20,
      });
      expect(ending).toBeGreaterThan(normal);
    });

    it("末镜优先级高于开场：极短剧里最后一镜不被当快切压掉", () => {
      // 3 镜全片：index 2 同时落在开场窗口(<3)与末镜，必须按末镜处理
      const d = computeShotDuration({
        shotType: "特写",
        sceneIndex: 2,
        totalScenes: 3,
      });
      expect(d).toBeGreaterThanOrEqual(3);
    });

    it("末镜优先级高于高潮：高潮结尾仍留白", () => {
      const d = computeShotDuration({
        shotType: "全景",
        sceneIndex: 19,
        totalScenes: 20,
        isClimax: true,
      });
      expect(d).toBeGreaterThanOrEqual(3);
    });
  });

  describe("铺垫段：不受影响", () => {
    it("中段常规镜与不传位置上下文时结果一致", () => {
      for (const shotType of ["特写", "近景", "中景", "全景", "远景"]) {
        expect(
          computeShotDuration({ shotType, sceneIndex: 10, totalScenes: 20 })
        ).toBe(computeShotDuration({ shotType }));
      }
    });
  });

  it("节奏曲线产出的时长仍是 [1,60] 的整数", () => {
    const cases = [
      { sceneIndex: 0, totalScenes: 20 },
      { sceneIndex: 10, totalScenes: 20, isClimax: true },
      { sceneIndex: 19, totalScenes: 20 },
    ];
    for (const extra of cases) {
      const d = computeShotDuration({ shotType: "特写", ...extra });
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(60);
    }
  });
});

describe("calibrateSceneDurations — 批量校准接节奏曲线", () => {
  const makeScenes = (n: number): CalibratableScene[] =>
    Array.from({ length: n }, () => ({ shotType: "全景" }));

  it("按数组下标自动套用开场/中段/末镜节奏", () => {
    const result = calibrateSceneDurations(makeScenes(10));
    // 开场 3 镜被压缩，短于中段
    expect(result[0].duration!).toBeLessThan(result[5].duration!);
    expect(result[2].duration!).toBeLessThan(result[5].duration!);
    // 末镜留白，长于中段
    expect(result[9].duration!).toBeGreaterThan(result[5].duration!);
  });

  it("透传 isClimax / beatType 到高潮压缩", () => {
    const scenes: CalibratableScene[] = [
      ...makeScenes(5),
      { shotType: "全景", isClimax: true },
      ...makeScenes(4),
    ];
    const result = calibrateSceneDurations(scenes);
    expect(result[5].duration!).toBeLessThan(result[4].duration!);
  });

  it("空数组不报错", () => {
    expect(calibrateSceneDurations([])).toEqual([]);
  });

  it("单镜数组：唯一一镜按末镜处理（留白）", () => {
    const result = calibrateSceneDurations<CalibratableScene>([
      { shotType: "特写" },
    ]);
    expect(result[0].duration!).toBeGreaterThanOrEqual(3);
  });

  it("immutable：不改动入参对象", () => {
    const scenes: CalibratableScene[] = [{ shotType: "全景", duration: 99 }];
    const result = calibrateSceneDurations(scenes);
    expect(scenes[0].duration).toBe(99);
    expect(result[0]).not.toBe(scenes[0]);
  });
});
