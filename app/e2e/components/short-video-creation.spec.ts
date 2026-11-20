import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { script } from "../../tests/fixtures/short-video";

const brief = `**最值得做：仙门严苛训练。**\n\n| 来源 | 原创改编 |\n|---|---|\n| [第三方榜单](https://example.test/source) | 师尊递来扫帚 |\n\n${"参考资料".repeat(300)}\n最后一条来源说明。\n\n<script>window.injected=true</script>\n[危险链接](javascript:alert(1))`;
async function setup(page: Page, saved = false, linked = false) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let content = saved ? script : null;
  let version = 3;
  await page.route("**/api/short-videos/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      if (path.endsWith("/scripts")) {
        content = body.content;
        version++;
        return route.fulfill({
          json: { id: "script-1", content, version: 1, origin: "MANUAL" },
        });
      }
      if (path.endsWith("/editor"))
        return route.fulfill({ json: { id: "project-1" } });
    }
    if (path === "capabilities")
      return route.fulfill({
        json: {
          userId: "creation-user",
          autoSubmitEnabled: false,
          platforms: [],
          defaultTimeZone: "Asia/Shanghai",
        },
      });
    if (path === "videos/video-1")
      return route.fulfill({
        json: {
          id: "video-1",
          title: "仙门严苛训练",
          brief,
          version,
          currentScriptVersionId: content ? "script-1" : null,
          projectId: linked ? "existing-project" : null,
          scripts: content
            ? [{ id: "script-1", version: 1, origin: "MANUAL", content }]
            : [],
          artifacts: [],
          runs: [],
        },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  return writes;
}

for (const width of [375, 1280]) {
  test(`brief renders safely and full adaptation prompt downloads without paid requests at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await setup(page);
    await page.goto("/short-video.html");
    await expect(
      page.getByRole("button", { name: "复制改编提示词", exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("LLM模型")).toBeHidden();
    await page.getByText("参考简报与来源 · 版本 3", { exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.locator("strong").filter({ hasText: "最值得做" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "第三方榜单" })
    ).toHaveAttribute("href", "https://example.test/source");
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => "injected" in window)).toBe(false);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载提示词 TXT" }).click();
    const file = await download;
    const text = await readFile((await file.path())!, "utf8");
    expect(file.suggestedFilename()).toContain("改编提示词.txt");
    expect(text).toContain("待改编");
    expect(text).toContain(brief);
    await page.getByRole("button", { name: "创建两镜脚本" }).click();
    await expect(page.getByLabel("故事设定", { exact: true })).toHaveValue("");
    expect(writes).toHaveLength(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  });
}

test("imports a fenced AI response, preserves draft on refresh, saves and opens the existing editor", async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto("/short-video.html");
  await expect(
    page.getByRole("button", { name: "将已保存脚本带入编辑器" })
  ).toBeDisabled();
  await page.getByText("粘贴 AI 返回的脚本", { exact: true }).click();
  const input = page.getByLabel("脚本内容（支持 JSON 或带 JSON 代码块的回复）");
  await input.fill("镜头一：御剑，镜头二：扫地");
  await expect(
    page.getByRole("button", { name: "应用到脚本表单" })
  ).toBeDisabled();
  await input.fill(
    `这是脚本：\n\n\`\`\`json\n${JSON.stringify(script)}\n\`\`\`\n请检查。`
  );
  await page.getByRole("button", { name: "应用到脚本表单" }).click();
  await expect(page.getByLabel("镜头1 · 首帧画面")).toHaveValue("办公室水豚");
  await expect(
    page.getByRole("button", { name: "复制完整创作提示词" })
  ).toBeVisible();
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  await expect(page.getByLabel("镜头1 · 首帧画面")).toHaveValue("办公室水豚");
  await page.getByRole("button", { name: "保存为新版本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "将已保存脚本带入编辑器" })
  ).toBeEnabled();
  await page.getByRole("button", { name: "将已保存脚本带入编辑器" }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-navigation",
    "/editor/project-1"
  );
  expect(writes).toHaveLength(2);
  expect(writes[0].body.content).toEqual(script);
  expect(writes[1]).toMatchObject({
    path: "videos/video-1/editor",
    body: { scriptVersionId: "script-1", expectedVideoVersion: 4 },
  });
});

test("exports current unsaved edits and reopens a linked project without overwriting it", async ({
  page,
}) => {
  const writes = await setup(page, true, true);
  await page.goto("/short-video.html");
  await page.getByLabel("镜头1 · 视频动作").fill("尚未保存的推镜动作");
  await expect(
    page.getByRole("link", { name: "打开已有编辑器项目" })
  ).toHaveAttribute("href", "/editor/existing-project");
  await page.getByText("查看导出的提示词", { exact: true }).click();
  await expect(page.getByLabel("可复制的创作提示词")).toContainText(
    "尚未保存的推镜动作"
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    })
  );
  await page.getByRole("button", { name: "复制完整创作提示词" }).click();
  await expect(page.getByRole("alert")).toContainText("下载 TXT");
  expect(writes).toHaveLength(0);
});

test("canceling import keeps existing draft and copying uses current content", async ({
  page,
}) => {
  const writes = await setup(page, true);
  await page.goto("/short-video.html");
  await page.getByText("粘贴 AI 返回的脚本", { exact: true }).click();
  await page
    .getByLabel("脚本内容（支持 JSON 或带 JSON 代码块的回复）")
    .fill(JSON.stringify({ ...script, title: "替代脚本" }));
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "应用到脚本表单" }).click();
  await expect(page.getByLabel("脚本标题", { exact: true })).toHaveValue(
    script.title
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.body.dataset.copied = value;
        },
      },
    })
  );
  await page.getByRole("button", { name: "复制完整创作提示词" }).click();
  await expect(page.getByRole("status")).toContainText("已复制");
  expect(await page.locator("body").getAttribute("data-copied")).toContain(
    script.shots[0].imagePrompt
  );
  expect(writes).toHaveLength(0);
});
