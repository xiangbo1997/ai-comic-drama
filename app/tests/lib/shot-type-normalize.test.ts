import { describe, it, expect } from "vitest";
import {
  parseCompositeShot,
  normalizeShotType,
  isCanonicalShotType,
} from "@/lib/shot-type-normalize";
import { CAMERA_MOVEMENTS } from "@/lib/prompts/camera-movements";

describe("parseCompositeShot", () => {
  it("标准五景别原样返回，无运镜", () => {
    for (const shot of ["特写", "近景", "中景", "全景", "远景"]) {
      expect(parseCompositeShot(shot)).toEqual({
        shotType: shot,
        cameraMovement: null,
      });
    }
  });

  it("拆分九宫格复合值（派单示例）", () => {
    expect(parseCompositeShot("大特写·急推")).toEqual({
      shotType: "特写",
      cameraMovement: "dolly_in",
    });
    expect(parseCompositeShot("近景·横移")).toEqual({
      shotType: "近景",
      cameraMovement: "pan_right",
    });
    expect(parseCompositeShot("大全景·缓推")).toEqual({
      shotType: "远景",
      cameraMovement: "zoom_in",
    });
  });

  it("景别别名归一到标准五档", () => {
    expect(normalizeShotType("大特写")).toBe("特写");
    expect(normalizeShotType("极特写")).toBe("特写");
    expect(normalizeShotType("大全景")).toBe("远景");
    expect(normalizeShotType("大远景")).toBe("远景");
    expect(normalizeShotType("半身")).toBe("近景");
    expect(normalizeShotType("胸像")).toBe("近景");
    expect(normalizeShotType("全身")).toBe("全景");
  });

  it("各类分隔符都能切分", () => {
    const expected = { shotType: "特写", cameraMovement: "dolly_in" };
    for (const sep of ["·", "・", "+", "，", ",", " ", "/", "|"]) {
      expect(parseCompositeShot(`特写${sep}急推`)).toEqual(expected);
    }
  });

  it("无分隔符的连写也能拆", () => {
    expect(parseCompositeShot("特写急推")).toEqual({
      shotType: "特写",
      cameraMovement: "dolly_in",
    });
  });

  it("镜内景别变化取终点景别，显式运镜优先", () => {
    expect(parseCompositeShot("中景→特写·快速推近")).toEqual({
      shotType: "特写",
      cameraMovement: "dolly_in",
    });
    // 各种箭头写法
    for (const arrow of ["→", "->", "=>", ">"]) {
      expect(parseCompositeShot(`全景${arrow}近景`).shotType).toBe("近景");
    }
  });

  it("无显式运镜时按取景收窄/放宽推断推拉方向", () => {
    // 取景收窄 = 推进
    expect(parseCompositeShot("远景→特写")).toEqual({
      shotType: "特写",
      cameraMovement: "dolly_in",
    });
    // 取景放宽 = 拉远
    expect(parseCompositeShot("特写→远景")).toEqual({
      shotType: "远景",
      cameraMovement: "zoom_out",
    });
  });

  it("纯运镜无景别 → shotType 为 null，不臆造景别", () => {
    expect(parseCompositeShot("急推")).toEqual({
      shotType: null,
      cameraMovement: "dolly_in",
    });
    expect(parseCompositeShot("横移")).toEqual({
      shotType: null,
      cameraMovement: "pan_right",
    });
  });

  it("空值 / null / 空白 → 全 null", () => {
    expect(parseCompositeShot(null)).toEqual({
      shotType: null,
      cameraMovement: null,
    });
    expect(parseCompositeShot(undefined)).toEqual({
      shotType: null,
      cameraMovement: null,
    });
    expect(parseCompositeShot("")).toEqual({
      shotType: null,
      cameraMovement: null,
    });
    expect(parseCompositeShot("   ")).toEqual({
      shotType: null,
      cameraMovement: null,
    });
  });

  it("完全无法识别的乱输入 → 原样保留，不臆造景别", () => {
    expect(parseCompositeShot("asdfgh")).toEqual({
      shotType: "asdfgh",
      cameraMovement: null,
    });
    expect(parseCompositeShot("随便写的东西")).toEqual({
      shotType: "随便写的东西",
      cameraMovement: null,
    });
  });

  it("机位角度键（非景别）原样保留，供 SHOT_MAP 命中", () => {
    // 俯拍/过肩等是机位而非景别，SHOT_MAP 认这些键，不能被吞掉
    expect(parseCompositeShot("过肩")).toEqual({
      shotType: "过肩",
      cameraMovement: null,
    });
    expect(parseCompositeShot("俯拍")).toEqual({
      shotType: "俯拍",
      cameraMovement: null,
    });
  });

  it("机位角度 + 运镜：运镜拆出，机位键保留在 shotType", () => {
    expect(parseCompositeShot("过肩·急推")).toEqual({
      shotType: "过肩",
      cameraMovement: "dolly_in",
    });
  });

  it("已是合法英文枚举值时直接采信", () => {
    expect(parseCompositeShot("特写·dolly_in")).toEqual({
      shotType: "特写",
      cameraMovement: "dolly_in",
    });
    expect(parseCompositeShot("中景 TRACKING")).toEqual({
      shotType: "中景",
      cameraMovement: "tracking",
    });
  });

  it("长词优先：急推不被推抢先匹配，大全景不被全景抢先", () => {
    expect(parseCompositeShot("急推").cameraMovement).toBe("dolly_in");
    expect(parseCompositeShot("推").cameraMovement).toBe("zoom_in");
    expect(parseCompositeShot("大全景").shotType).toBe("远景");
    expect(parseCompositeShot("全景").shotType).toBe("全景");
  });

  it("解析出的运镜必定落在 13 值枚举内", () => {
    const samples = [
      "大特写·急推",
      "近景·横移",
      "全景·跟拍",
      "中景·环绕",
      "远景·升",
      "特写·固定",
      "中景·手持",
      "全景·下摇",
      "近景·缓拉",
      "远景·左摇",
    ];
    for (const s of samples) {
      const { cameraMovement } = parseCompositeShot(s);
      expect(cameraMovement).not.toBeNull();
      expect(CAMERA_MOVEMENTS).toContain(cameraMovement!);
    }
  });
});

describe("isCanonicalShotType", () => {
  it("只认五个标准景别，排除机位角度键", () => {
    expect(isCanonicalShotType("特写")).toBe(true);
    expect(isCanonicalShotType("远景")).toBe(true);
    // 机位角度不是景别，不参与级差排序
    expect(isCanonicalShotType("俯拍")).toBe(false);
    expect(isCanonicalShotType("过肩")).toBe(false);
    expect(isCanonicalShotType("大特写")).toBe(false); // 别名需先归一
    expect(isCanonicalShotType(null)).toBe(false);
    expect(isCanonicalShotType(undefined)).toBe(false);
  });
});
