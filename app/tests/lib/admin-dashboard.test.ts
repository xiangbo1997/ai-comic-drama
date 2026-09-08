/**
 * 后台仪表盘助手单测
 *
 * 这些纯函数同时被服务端聚合与前端展示使用，口径漂了两边就对不上，故重点覆盖：
 *  - 成功率的分母口径（含在途任务）与 total=0 时不产生 NaN
 *  - 字节/时长格式化的缺失值与边界进位
 *  - 僵尸切点按传入的 now 计算（可测，不依赖真实时钟）
 *  - 积分序列归一化必须共用同一基准（否则柱状图完全误导）
 */

import { describe, it, expect } from "vitest";

import {
  ZOMBIE_THRESHOLD_MS,
  computeSuccessRate,
  daysAgo,
  formatBytes,
  formatPercent,
  formatUptime,
  normalizeCreditSeries,
  overallSuccessRate,
  summarizeGenerationStats,
  truncateText,
  zombieCutoff,
  type TaskStatusCount,
} from "@/lib/admin-dashboard";

describe("computeSuccessRate", () => {
  it("total 为 0 时返回 0 而不是 NaN", () => {
    expect(computeSuccessRate(0, 0)).toBe(0);
    expect(Number.isNaN(computeSuccessRate(0, 0))).toBe(false);
  });

  it("负数 total 同样按 0 处理", () => {
    expect(computeSuccessRate(3, -1)).toBe(0);
  });

  it("保留四位小数", () => {
    // 1/3 = 0.333333… → 0.3333
    expect(computeSuccessRate(1, 3)).toBe(0.3333);
  });

  it("全成功为 1", () => {
    expect(computeSuccessRate(7, 7)).toBe(1);
  });
});

describe("summarizeGenerationStats", () => {
  const rows: TaskStatusCount[] = [
    { type: "IMAGE_GENERATE", status: "COMPLETED", count: 8 },
    { type: "IMAGE_GENERATE", status: "FAILED", count: 1 },
    { type: "IMAGE_GENERATE", status: "PROCESSING", count: 1 },
    { type: "VIDEO_GENERATE", status: "COMPLETED", count: 1 },
    { type: "VIDEO_GENERATE", status: "FAILED", count: 1 },
  ];

  it("按类型折叠并把在途任务算进分母", () => {
    const stats = summarizeGenerationStats(rows);
    const image = stats.find((s) => s.type === "IMAGE_GENERATE");

    expect(image).toBeDefined();
    // 8 成功 + 1 失败 + 1 在途 = 10，成功率 0.8（而非 8/9）
    expect(image?.total).toBe(10);
    expect(image?.success).toBe(8);
    expect(image?.failed).toBe(1);
    expect(image?.successRate).toBe(0.8);
  });

  it("按 total 降序排列，量大的类型排在前面", () => {
    const stats = summarizeGenerationStats(rows);
    expect(stats.map((s) => s.type)).toEqual([
      "IMAGE_GENERATE",
      "VIDEO_GENERATE",
    ]);
  });

  it("空输入返回空数组", () => {
    expect(summarizeGenerationStats([])).toEqual([]);
  });

  it("未知状态只计入 total，不算成功也不算失败", () => {
    const stats = summarizeGenerationStats([
      { type: "EXPORT", status: "PENDING", count: 4 },
    ]);
    expect(stats[0]).toMatchObject({
      total: 4,
      success: 0,
      failed: 0,
      successRate: 0,
    });
  });
});

describe("overallSuccessRate", () => {
  it("跨类型合并计算，而不是各类型成功率再平均", () => {
    const stats = summarizeGenerationStats([
      { type: "A", status: "COMPLETED", count: 90 },
      { type: "A", status: "FAILED", count: 10 },
      { type: "B", status: "FAILED", count: 1 },
    ]);
    // 合并口径 90/101；若先按类型算成功率(0.9, 0)再平均会得到 0.45
    expect(overallSuccessRate(stats)).toBe(0.8911);
  });

  it("无数据时为 0", () => {
    expect(overallSuccessRate([])).toBe(0);
  });
});

describe("formatPercent", () => {
  it("默认一位小数", () => {
    expect(formatPercent(0.8911)).toBe("89.1%");
  });

  it("可指定精度", () => {
    expect(formatPercent(0.5, 0)).toBe("50%");
  });
});

describe("formatBytes", () => {
  it("缺失值返回短横线", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(undefined)).toBe("-");
    expect(formatBytes(Number.NaN)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
  });

  it("零与不足 1 字节显示 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("字节级不带小数", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("按 1024 进制换算并保留一位小数", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 3.5)).toBe("3.5 GB");
  });

  it("超出最大单位时不再进位", () => {
    const huge = 1024 ** 6 * 5; // 5 EB，超过 PB
    expect(formatBytes(huge)).toContain("PB");
  });
});

describe("formatUptime", () => {
  it("缺失值返回短横线", () => {
    expect(formatUptime(null)).toBe("-");
    expect(formatUptime(undefined)).toBe("-");
    expect(formatUptime(-5)).toBe("-");
  });

  it("不足一秒显示 0秒", () => {
    expect(formatUptime(0.4)).toBe("0秒");
  });

  it("只显示最高的两个量级", () => {
    // 3天 4小时 5分钟 6秒 → 只留前两级
    const seconds = 3 * 86400 + 4 * 3600 + 5 * 60 + 6;
    expect(formatUptime(seconds)).toBe("3天 4小时");
  });

  it("跳过为零的中间量级", () => {
    // 2天 0小时 30分钟 → 天与分钟
    expect(formatUptime(2 * 86400 + 30 * 60)).toBe("2天 30分钟");
  });

  it("分钟秒级正常展示", () => {
    expect(formatUptime(5 * 60 + 12)).toBe("5分钟 12秒");
  });
});

describe("zombieCutoff", () => {
  it("按传入的 now 回退阈值", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    expect(zombieCutoff(now).toISOString()).toBe("2026-09-08T11:45:00.000Z");
  });

  it("阈值可覆盖", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    expect(zombieCutoff(now, 60_000).toISOString()).toBe(
      "2026-09-08T11:59:00.000Z"
    );
  });

  it("默认阈值是 15 分钟", () => {
    expect(ZOMBIE_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });
});

describe("daysAgo", () => {
  it("按天回退", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    expect(daysAgo(7, now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(daysAgo(30, now).toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });
});

describe("truncateText", () => {
  it("空值返回 null", () => {
    expect(truncateText(null)).toBeNull();
    expect(truncateText("")).toBeNull();
  });

  it("未超长原样返回", () => {
    expect(truncateText("短错误", 200)).toBe("短错误");
  });

  it("超长截断并加省略号", () => {
    const long = "x".repeat(250);
    const result = truncateText(long, 200);
    expect(result).toHaveLength(201); // 200 字符 + 省略号
    expect(result?.endsWith("…")).toBe(true);
  });
});

describe("normalizeCreditSeries", () => {
  it("发放与扣减共用同一基准", () => {
    const result = normalizeCreditSeries([
      { date: "2026-09-01", granted: 10, charged: -100 },
      { date: "2026-09-02", granted: 50, charged: -50 },
    ]);

    // 峰值是 100（扣减侧），发放 10 应该只有 0.1 的高度
    expect(result[0]?.grantedRatio).toBeCloseTo(0.1);
    expect(result[0]?.chargedRatio).toBeCloseTo(1);
    expect(result[1]?.grantedRatio).toBeCloseTo(0.5);
  });

  it("全零序列不产生除零", () => {
    const result = normalizeCreditSeries([
      { date: "2026-09-01", granted: 0, charged: 0 },
    ]);
    expect(result[0]?.grantedRatio).toBe(0);
    expect(result[0]?.chargedRatio).toBe(0);
  });

  it("空输入返回空数组", () => {
    expect(normalizeCreditSeries([])).toEqual([]);
  });

  it("保留原始字段", () => {
    const result = normalizeCreditSeries([
      { date: "2026-09-01", granted: 5, charged: -5 },
    ]);
    expect(result[0]).toMatchObject({
      date: "2026-09-01",
      granted: 5,
      charged: -5,
    });
  });
});
