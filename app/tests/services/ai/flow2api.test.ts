import { describe, it, expect } from "vitest";
import {
  flow2apiChatUrl,
  isTransientImageLoadError,
} from "@/services/ai/providers/flow2api-shared";
import { adaptModelOrientation } from "@/services/ai/providers/flow2api-image";
import {
  planImageInputs,
  chooseModel,
} from "@/services/ai/providers/flow2api-video";
import type { AIServiceConfig, VideoGenerationOptions } from "@/types";

describe("flow2apiChatUrl（Base URL 尾部 /v1 去重）", () => {
  it("不带 /v1 的推荐写法直接拼接", () => {
    expect(flow2apiChatUrl("https://flow2api.example.com")).toBe(
      "https://flow2api.example.com/v1/chat/completions"
    );
  });

  it("带 /v1 的 OpenAI 兼容习惯写法不重复拼接", () => {
    expect(flow2apiChatUrl("https://flow2api.example.com/v1")).toBe(
      "https://flow2api.example.com/v1/chat/completions"
    );
  });

  it("尾部斜杠被清理", () => {
    expect(flow2apiChatUrl("https://flow2api.example.com/v1/")).toBe(
      "https://flow2api.example.com/v1/chat/completions"
    );
    expect(flow2apiChatUrl("https://flow2api.example.com/")).toBe(
      "https://flow2api.example.com/v1/chat/completions"
    );
  });
});

describe("isTransientImageLoadError（瞬时抓图失败判定）", () => {
  it("网关 Failed to load image 错误命中（r2.dev 限流场景）", () => {
    expect(
      isTransientImageLoadError(
        'flow2api 请求失败（400）：{"detail":"Failed to load image from https://pub-x.r2.dev/a.webp"}'
      )
    ).toBe(true);
  });

  it("其他 400/超时错误不命中，不误重试", () => {
    expect(isTransientImageLoadError("flow2api 任务失败: 档位不支持")).toBe(
      false
    );
    expect(isTransientImageLoadError("flow2api 视频生成超时（>30 分钟）")).toBe(
      false
    );
  });
});

describe("adaptModelOrientation（按画幅改写模型朝向后缀）", () => {
  it("landscape → portrait", () => {
    expect(
      adaptModelOrientation("gemini-3.0-pro-image-landscape", "portrait")
    ).toBe("gemini-3.0-pro-image-portrait");
  });

  it("朝向一致时原样返回", () => {
    expect(
      adaptModelOrientation("gemini-3.0-pro-image-portrait", "portrait")
    ).toBe("gemini-3.0-pro-image-portrait");
  });

  it("保留分辨率后缀（-2k / -4k）", () => {
    expect(
      adaptModelOrientation("gemini-3.1-flash-image-landscape-4k", "portrait")
    ).toBe("gemini-3.1-flash-image-portrait-4k");
  });

  it("four-three 等特殊朝向也可替换", () => {
    expect(
      adaptModelOrientation("gemini-3.0-pro-image-four-three", "landscape")
    ).toBe("gemini-3.0-pro-image-landscape");
  });

  it("imagen 系列没有 square 变体：目标 square 时不改写", () => {
    expect(
      adaptModelOrientation("imagen-4.0-generate-preview-landscape", "square")
    ).toBe("imagen-4.0-generate-preview-landscape");
  });

  it("gemini 系列目标 square 时正常改写", () => {
    expect(
      adaptModelOrientation("gemini-3.0-pro-image-landscape", "square")
    ).toBe("gemini-3.0-pro-image-square");
  });

  it("imagen 系列 landscape ↔ portrait 正常改写", () => {
    expect(
      adaptModelOrientation("imagen-4.0-generate-preview-landscape", "portrait")
    ).toBe("imagen-4.0-generate-preview-portrait");
  });

  it("无朝向 token 的自定义模型名不猜测、原样返回", () => {
    expect(adaptModelOrientation("my-custom-model", "portrait")).toBe(
      "my-custom-model"
    );
  });
});

describe("planImageInputs（按视频模型类别裁剪图片输入）", () => {
  const main = "https://x/scene.png";
  const refs = [
    "https://x/front.png",
    "https://x/side.png",
    "https://x/back.png",
  ];

  it("t2v 不接受图片：全部丢弃", () => {
    expect(planImageInputs("veo_3_1_t2v_fast_portrait", main, refs)).toEqual(
      []
    );
  });

  it("i2v 只吃 1 张首帧：角色参考图被裁掉", () => {
    expect(planImageInputs("veo_3_1_i2v_lite_portrait", main, refs)).toEqual([
      main,
    ]);
  });

  it("fl（首尾帧）第 2 张只认显式尾帧：[首帧, 尾帧]", () => {
    expect(
      planImageInputs(
        "veo_3_1_i2v_s_fast_portrait_8s_fl",
        main,
        refs,
        "https://x/next-scene.png"
      )
    ).toEqual([main, "https://x/next-scene.png"]);
  });

  it("fl 无尾帧时角色参考图不得补位：只送首帧（回归：钉 FL 模型致视频结尾闪现立绘）", () => {
    expect(
      planImageInputs("veo_3_1_i2v_s_fast_portrait_fl", main, refs)
    ).toEqual([main]);
  });

  it("interpolation（首尾帧过渡）同样只认显式尾帧", () => {
    expect(
      planImageInputs(
        "veo_3_1_interpolation_lite_portrait",
        main,
        refs,
        "https://x/next-scene.png"
      )
    ).toEqual([main, "https://x/next-scene.png"]);
    expect(
      planImageInputs("veo_3_1_interpolation_lite_portrait", main, refs)
    ).toEqual([main]);
  });

  it("r2v 参考图语义：最多 3 张", () => {
    expect(
      planImageInputs("veo_3_1_r2v_fast_portrait", undefined, refs)
    ).toEqual(refs);
    expect(planImageInputs("veo_3_1_r2v_fast", main, refs)).toEqual([
      main,
      refs[0],
      refs[1],
    ]);
  });

  it("fl 放大变体（_fl_4k）也按首尾帧分槽", () => {
    expect(
      planImageInputs(
        "veo_3_1_i2v_s_fast_ultra_fl_4k",
        main,
        refs,
        "https://x/next-scene.png"
      )
    ).toEqual([main, "https://x/next-scene.png"]);
    expect(
      planImageInputs("veo_3_1_i2v_s_fast_ultra_fl_4k", main, refs)
    ).toEqual([main]);
  });
});

describe("chooseModel（尾帧衔接 lastFrameImage 路由 FL）", () => {
  const cfg = {
    protocol: "openai",
    baseUrl: "https://flow2api.example.com",
    apiKey: "k",
  } as AIServiceConfig;
  const base: VideoGenerationOptions = {
    imageUrl: "https://x/scene-1.png",
    prompt: "camera push in",
  };

  it("主图 + 尾帧 → FL 首尾帧模型（无横竖屏后缀）", () => {
    expect(
      chooseModel({ ...base, lastFrameImage: "https://x/scene-2.png" }, cfg)
    ).toBe("veo_3_1_i2v_s_fast_fl");
  });

  it("竖屏 + 尾帧 → 仍是同一 FL 模型 ID", () => {
    expect(
      chooseModel(
        {
          ...base,
          aspectRatio: "9:16",
          lastFrameImage: "https://x/scene-2.png",
        },
        cfg
      )
    ).toBe("veo_3_1_i2v_s_fast_fl");
  });

  it("主图无尾帧（即使带角色参考图）→ 标准 I2V，参考图不当尾帧", () => {
    expect(
      chooseModel(
        {
          ...base,
          aspectRatio: "9:16",
          referenceImages: ["https://x/ref.png"],
        },
        cfg
      )
    ).toBe("veo_3_1_i2v_s_portrait");
  });

  it("config.model 显式指定时优先，不被尾帧路由覆盖", () => {
    expect(
      chooseModel(
        { ...base, lastFrameImage: "https://x/scene-2.png" },
        { ...cfg, model: "veo_3_1_i2v_lite_landscape" }
      )
    ).toBe("veo_3_1_i2v_lite_landscape");
  });

  it("尾帧场景的图片输入严格为 [首帧, 尾帧]", () => {
    expect(
      planImageInputs(
        "veo_3_1_i2v_s_fast_fl",
        base.imageUrl,
        [],
        "https://x/scene-2.png"
      )
    ).toEqual([base.imageUrl, "https://x/scene-2.png"]);
  });
});
