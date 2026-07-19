import { describe, it, expect } from "vitest";
import { buildSfxSchedule } from "@/services/video-synthesis";
import { getSfxById } from "@/lib/sfx-library";

const sceneStarts = [0, 3, 7];
const sceneIds = ["s1", "s2", "s3"];

describe("buildSfxSchedule（导出/预览同源触发时间表）", () => {
  it("显式配置：triggerSec = 分镜起点 + 镜内偏移；音量缺省用库默认", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s2", sfxId: "glass-shatter", offsetSec: 1 }],
      sceneStarts,
      sceneIds
    );
    expect(items).toHaveLength(1);
    expect(items[0].triggerSec).toBe(4);
    expect(items[0].volume).toBe(getSfxById("glass-shatter")!.defaultVolume);
    expect(items[0].origin).toBe("config");
  });

  it("自定义音量钳到 0-1", () => {
    const items = buildSfxSchedule(
      [{ sceneId: "s1", sfxId: "hit-punch", offsetSec: 0, volume: 5 }],
      sceneStarts,
      sceneIds
    );
    expect(items[0].volume).toBe(1);
  });

  it("未知 sfxId / 未知 sceneId 静默跳过（优雅降级）", () => {
    const items = buildSfxSchedule(
      [
        { sceneId: "s1", sfxId: "nope", offsetSec: 0 },
        { sceneId: "ghost", sfxId: "hit-punch", offsetSec: 0 },
      ],
      sceneStarts,
      sceneIds
    );
    expect(items).toHaveLength(0);
  });

  it("转场触发点补 whoosh（origin=transition），负值/非法点跳过", () => {
    const items = buildSfxSchedule(undefined, sceneStarts, sceneIds, [3, -1]);
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe("transition");
    expect(items[0].triggerSec).toBe(3);
  });

  it("按触发时刻升序排序", () => {
    const items = buildSfxSchedule(
      [
        { sceneId: "s3", sfxId: "hit-punch", offsetSec: 0 },
        { sceneId: "s1", sfxId: "glass-break", offsetSec: 0.5 },
      ],
      sceneStarts,
      sceneIds,
      [3]
    );
    expect(items.map((i) => i.triggerSec)).toEqual([0.5, 3, 7]);
  });

  it("空配置 + 无转场点 → 空表", () => {
    expect(buildSfxSchedule(undefined, sceneStarts, sceneIds)).toHaveLength(0);
    expect(buildSfxSchedule([], sceneStarts, sceneIds)).toHaveLength(0);
  });
});
