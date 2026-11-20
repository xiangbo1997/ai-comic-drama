import { expect, test, type Page } from "@playwright/test";

const savedScript = {
  schemaVersion: 1,
  title: "午休会议",
  hook: "开会的是闹钟",
  premise: "闹钟申请午休",
  targetDurationSec: 20,
  aspectRatio: "9:16",
  characters: [],
  shots: [
    {
      key: "s1",
      durationSec: 10,
      description: "闹钟敲桌子",
      imagePrompt: "桌上的闹钟",
      videoPrompt: "闹钟敲桌子",
      dialogue: "申请午休",
      narration: "",
      subtitle: "申请午休",
      characterKeys: [],
    },
    {
      key: "s2",
      durationSec: 10,
      description: "桌子开始打鼾",
      imagePrompt: "安静的桌子",
      videoPrompt: "桌子轻轻震动",
      dialogue: "",
      narration: "全票通过",
      subtitle: "全票通过",
      characterKeys: [],
    },
  ],
  ending: "全办公室午休",
  suggestedCaption: "今天的会就开到这",
  hashtags: ["原创动画"],
};
const artifact = (kind = "VIDEO") => ({
  id: kind === "VIDEO" ? "film-1" : "cover-1",
  version: 1,
  kind,
  bytes: "1024",
  durationMs: kind === "VIDEO" ? 20000 : null,
  width: 720,
  height: 1280,
  storageBackend: "LOCAL",
  verifiedAt: "2026-11-19T00:00:00Z",
});
async function setup(
  page: Page,
  options: { scripts?: boolean; film?: boolean } = {}
) {
  await page.route("**/api/short-videos/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (path === "capabilities")
      return route.fulfill({
        json: {
          userId: "ux-test",
          autoSubmitEnabled: false,
          defaultTimeZone: "Asia/Shanghai",
          platforms: [],
        },
      });
    if (path === "videos/video-1")
      return route.fulfill({
        json: {
          id: "video-1",
          title: "午休会议",
          brief: "闹钟申请午休",
          version: 1,
          scripts: options.scripts
            ? [
                {
                  id: "script-1",
                  version: 1,
                  origin: "MANUAL",
                  content: savedScript,
                },
              ]
            : [],
          artifacts: options.film ? [artifact()] : [],
          runs: [],
        },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
}

test("saved scripts open as editable shots and refreshing does not overwrite a draft", async ({
  page,
}) => {
  await setup(page, { scripts: true });
  const writes: Record<string, unknown>[] = [];
  await page.route(
    "**/api/short-videos/videos/video-1/scripts",
    async (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          id: "script-2",
          version: 2,
          origin: "MANUAL",
          content: savedScript,
        },
      });
    }
  );
  await page.goto("/short-video.html");
  await expect(page.getByLabel("脚本版本", { exact: true })).toHaveValue(
    "script-1"
  );
  await page.getByLabel("镜头1 · 画面与动作").fill("闹钟举起午休申请书");
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  await expect(page.getByLabel("镜头1 · 画面与动作")).toHaveValue(
    "闹钟举起午休申请书"
  );
  await page.getByRole("button", { name: "保存为新版本", exact: true }).click();
  expect(writes).toHaveLength(1);
  expect((writes[0].content as typeof savedScript).shots[0].description).toBe(
    "闹钟举起午休申请书"
  );
});

test("a new script can be authored with form fields without editing JSON", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/short-video.html");
  await page.getByRole("button", { name: "创建两镜脚本" }).click();
  await expect(page.getByLabel("脚本标题", { exact: true })).toHaveValue(
    "午休会议"
  );
  await page.getByLabel("开场钩子").fill("开会的是闹钟");
  await page.getByLabel("故事设定").fill("闹钟申请午休");
  for (const number of [1, 2]) {
    await page
      .getByLabel(`镜头${number} · 画面与动作`)
      .fill(`第${number}镜动作`);
    await page.getByLabel(`镜头${number} · 首帧画面`).fill(`第${number}镜首帧`);
    await page
      .getByLabel(`镜头${number} · 视频动作`)
      .fill(`第${number}镜动作提示`);
  }
  await expect(page.getByText("镜头合计 20 秒 / 目标 20 秒")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存为新版本", exact: true })
  ).toBeEnabled();
});

test("cover upload selects the cover and preserves the selected film", async ({
  page,
}) => {
  await setup(page, { film: true });
  await page.route(
    "**/api/short-videos/videos/video-1/artifacts/upload",
    (route) => route.fulfill({ json: artifact("COVER") })
  );
  await page.goto("/short-video.html");
  await expect(page.getByLabel("成片版本", { exact: true })).toHaveValue(
    "film-1"
  );
  await page.getByLabel("素材类型", { exact: true }).selectOption("COVER");
  await page.getByLabel("选择素材").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture only"),
  });
  await page.getByLabel("我确认素材使用权限，备注").fill("本人原创");
  await page.getByRole("button", { name: "上传并检查素材" }).click();
  await expect(page.getByLabel("成片版本", { exact: true })).toHaveValue(
    "film-1"
  );
});

test("work title and publication title are independent and detail navigation is accessible", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/short-video.html");
  await expect(
    page.getByRole("navigation", { name: "创作步骤" })
  ).toBeVisible();
  await page.getByText("作品管理 · 标题与归档", { exact: true }).click();
  await page.getByLabel("更新标题", { exact: true }).fill("作品名称修改");
  await page.getByLabel("发布标题", { exact: true }).fill("平台标题");
  await expect(page.getByLabel("更新标题", { exact: true })).toHaveValue(
    "作品名称修改"
  );
  await expect(page.getByLabel("发布标题", { exact: true })).toHaveValue(
    "平台标题"
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test("a newly created generation plan survives a stale latest-run list", async ({
  page,
}) => {
  await setup(page, { scripts: true });
  const run = (id: string) => ({
    id,
    kind: "RENDER",
    status: "PLANNED",
    version: 1,
    planHash: "a".repeat(64),
    spentCredits: 0,
    reservedCredits: 0,
    maxCredits: 20,
    plan: { models: [], upperBoundCredits: 10, supplierFees: "未取得账单" },
    steps: [],
  });
  await page.route("**/api/short-videos/models", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "image",
            selectedModel: "image",
            provider: { category: "IMAGE", name: "图像" },
          },
          {
            id: "video",
            selectedModel: "video",
            provider: { category: "VIDEO", name: "视频" },
          },
        ],
      },
    })
  );
  await page.route("**/api/short-videos/videos/video-1", (route) =>
    route.fulfill({
      json: {
        id: "video-1",
        title: "新计划测试",
        version: 1,
        scripts: [
          {
            id: "script-1",
            version: 1,
            origin: "MANUAL",
            content: savedScript,
          },
        ],
        artifacts: [],
        runs: [{ id: "run-old" }],
      },
    })
  );
  await page.route("**/api/short-videos/runs/*", (route) =>
    route.fulfill({
      json: run(new URL(route.request().url()).pathname.split("/").pop()!),
    })
  );
  await page.route("**/api/short-videos/videos/video-1/render-plans", (route) =>
    route.fulfill({ json: run("run-new") })
  );
  await page.goto("/short-video.html");
  await page.getByLabel("IMAGE模型").selectOption("image");
  await page.getByLabel("VIDEO模型").selectOption("video");
  await page.getByRole("button", { name: "查看生成计划", exact: true }).click();
  await page.getByText("任务编号", { exact: true }).click();
  await expect(page.getByText("run-new", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  await expect(page.getByText("run-new", { exact: true })).toBeVisible();
  await expect(page.getByText("run-old", { exact: true })).toHaveCount(0);
});

test("an AI brief draft can choose a template and continue to a script plan", async ({
  page,
}) => {
  await setup(page);
  let saved = false;
  await page.route("**/api/short-videos/templates?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "template-1",
            name: "生活小事史诗化",
            enabled: true,
            version: 1,
          },
        ],
      },
    })
  );
  await page.route("**/api/short-videos/models", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "llm",
            selectedModel: "text",
            provider: { category: "LLM", name: "文本" },
          },
        ],
      },
    })
  );
  await page.route("**/api/short-videos/videos/video-1", (route) =>
    route.fulfill({
      json: {
        id: "video-1",
        title: "AI简报草稿",
        version: saved ? 2 : 1,
        templateId: saved ? "template-1" : null,
        template: saved ? { version: 1 } : null,
        scripts: [],
        artifacts: [],
        runs: [],
      },
    })
  );
  await page.route(
    "**/api/short-videos/videos/video-1",
    async (route, request) => {
      if (request.method() !== "PATCH") return route.fallback();
      expect(request.postDataJSON().templateId).toBe("template-1");
      saved = true;
      return route.fulfill({ json: { id: "video-1", version: 2 } });
    }
  );
  await page.goto("/short-video.html");
  await page.getByText("站内模型改编（可选）", { exact: true }).click();
  await page.getByLabel("LLM模型").selectOption("llm");
  await expect(
    page.getByRole("button", { name: "查看脚本改编计划" })
  ).toBeDisabled();
  await page
    .getByLabel("脚本改编模板", { exact: true })
    .selectOption("template-1");
  await page.getByRole("button", { name: "保存改编模板" }).click();
  await expect(
    page.getByRole("button", { name: "查看脚本改编计划" })
  ).toBeEnabled();
});

test("video filtering and next page keep the same query and progress", async ({
  page,
}) => {
  await setup(page);
  const queries: string[] = [];
  await page.route("**/api/short-videos/videos?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query.toString());
    const next = query.has("cursor");
    return route.fulfill({
      json: {
        items: [
          {
            id: next ? "v2" : "v1",
            title: next ? "午休二号" : "午休一号",
            workflowStatus: "SCRIPTED",
            version: 1,
          },
        ],
        nextCursor: next ? null : "cursor-token",
      },
    });
  });
  await page.goto("/short-video.html?mode=videos");
  await page.getByLabel("搜索作品", { exact: true }).fill("午休");
  await page.getByRole("button", { name: "搜索作品", exact: true }).click();
  await page.getByLabel("创作进度").selectOption("SCRIPTED");
  await expect(page.getByRole("article").first()).toContainText("午休一号");
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  const last = new URLSearchParams(queries.at(-1));
  expect(last.get("q")).toBe("午休");
  expect(last.get("status")).toBe("SCRIPTED");
  expect(last.get("cursor")).toBe("cursor-token");
});
