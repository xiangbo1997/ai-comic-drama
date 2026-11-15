import { expect, test, type Route } from "@playwright/test";

const snapshot = (title = "甲剧") => ({
  scope: { key: title, type: "project", id: title, title },
  messages: [
    {
      id: "answer",
      role: "assistant",
      content: `${title}的角色建议`,
      createdAt: "2026-11-14T00:00:00Z",
    },
  ],
  memory: { content: `${title}的设定`, version: 1 },
  context: { sources: ["角色", "剧本"], truncated: false },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({
      json: {
        configs: [
          {
            id: "default-config",
            selectedModel: "test-model",
            isDefault: true,
            testStatus: "SUCCESS",
            provider: {
              id: "provider",
              name: "测试文本模型",
              category: "LLM",
              models: [{ id: "test-model", name: "测试文本模型" }],
            },
          },
        ],
      },
    })
  );
  await page.route("**/api/assistant**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: snapshot(
        url.searchParams.get("projectId") === "project-b" ? "乙剧" : "甲剧"
      ),
    });
  });
  await page.goto("/assistant.html");
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
});

test("Markdown 标题、列表、表格、代码与来源链接正确解析且不执行 HTML", async ({
  page,
}) => {
  const content =
    '## 创作建议\n\n**增强冲突**，保留 `钩子`。\n\n- 第一项\n- 第二项\n\n| 镜头 | 建议 |\n| --- | --- |\n| 1 | 开门 |\n\n```json\n{"shot":1}\n```\n\n[资料来源](https://example.com/film)\n\n[危险链接](javascript:alert(1))\n\n<script>window.markdownExecuted=true</script>\n<img src="x" onerror="window.markdownExecuted=true">';
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({
      json: {
        ...snapshot(),
        messages: [{ ...snapshot().messages[0], content }],
      },
    })
  );
  await page.getByRole("button", { name: "刷新聊天" }).click();
  const log = page.getByRole("log", { name: "本剧对话" });
  await expect(log.getByRole("heading", { name: "创作建议" })).toBeVisible();
  await expect(log.locator("strong")).toHaveText("增强冲突");
  await expect(log.getByRole("listitem")).toHaveCount(2);
  await expect(log.getByRole("cell", { name: "开门" })).toBeVisible();
  await expect(log.locator("pre code")).toContainText('{"shot":1}');
  await expect(log.getByRole("link", { name: "资料来源" })).toHaveAttribute(
    "href",
    "https://example.com/film"
  );
  await expect(log.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(log.locator("script, img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { markdownExecuted?: boolean }).markdownExecuted
    )
  ).toBeUndefined();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});

test("显示当前剧上下文，建议加入记忆须显式保存，清空聊天须确认", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("甲剧的角色建议", { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText(/角色 · 剧本/)).toBeVisible();
  let saves = 0;
  let deletes = 0;
  await page.route("**/api/assistant/memory", async (route) => {
    saves++;
    const body = route.request().postDataJSON();
    expect(body.projectId).toBe("project-a");
    expect(body.content).toContain("甲剧的角色建议");
    await route.fulfill({
      json: { memory: { content: body.content, version: 2 } },
    });
  });
  await page.route("**/api/assistant/messages?**", async (route) => {
    deletes++;
    await route.fulfill({ json: { messages: [] } });
  });
  await dialog.getByRole("button", { name: "加入记忆草稿" }).click();
  expect(saves).toBe(0);
  await expect(dialog.getByRole("textbox", { name: "本剧记忆" })).toHaveValue(
    /甲剧的角色建议/
  );
  await dialog.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("记忆已保存");
  await dialog.getByRole("tab", { name: "对话", exact: true }).click();
  await dialog.getByRole("button", { name: "清空聊天", exact: true }).click();
  expect(deletes).toBe(0);
  await dialog.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(dialog.getByText("甲剧的角色建议", { exact: true })).toHaveCount(
    0
  );
  expect(deletes).toBe(1);
});

test("失败保留输入，重试复用请求 ID", async ({ page }) => {
  const requests: Record<string, string>[] = [];
  await page.route("**/api/assistant/messages", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      await route.fulfill({ status: 503, json: { error: "暂时不可用" } });
    else
      await route.fulfill({
        json: {
          ...snapshot(),
          messages: [
            ...snapshot().messages,
            {
              id: "new",
              role: "assistant",
              content: "重试成功",
              createdAt: "2026-11-14T00:00:00Z",
            },
          ],
        },
      });
  });
  const input = page.getByRole("textbox", { name: "向本剧助手提问" });
  await input.fill("怎样增强冲突？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("暂时不可用");
  await expect(input).toHaveValue("怎样增强冲突？");
  await page.getByRole("button", { name: "重试发送", exact: true }).click();
  await expect(page.getByText("重试成功", { exact: true })).toBeVisible();
  expect(requests[0].requestId).toBe(requests[1].requestId);
});

test("记忆冲突保留草稿，重新载入之前明确提示", async ({ page }) => {
  await page.route("**/api/assistant/memory", (route) =>
    route.fulfill({ status: 409, json: { error: "记忆版本冲突" } })
  );
  await page.getByRole("tab", { name: "剧集记忆", exact: true }).click();
  const memory = page.getByRole("textbox", { name: "本剧记忆" });
  await memory.fill("我的未保存设定");
  await page.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("其他页面");
  await expect(memory).toHaveValue("我的未保存设定");
  await expect(
    page.getByRole("button", { name: "载入最新记忆（覆盖草稿）" })
  ).toBeVisible();
});

test("切剧卸载旧对话，不带入上一剧草稿", async ({ page }) => {
  await page.getByRole("textbox", { name: "向本剧助手提问" }).fill("甲剧草稿");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "切换到乙剧" }).click();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByText("乙剧的角色建议", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toHaveValue("");
  await expect(page.getByText("甲剧的角色建议", { exact: true })).toHaveCount(
    0
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBeTruthy();
});

test("发送途中切剧，上一剧的迟到回复不会进入当前剧", async ({ page }) => {
  let pendingRoute: Route | undefined;
  await page.route("**/api/assistant/messages", (route) => {
    pendingRoute = route;
  });
  await page
    .getByRole("textbox", { name: "向本剧助手提问" })
    .fill("甲剧的问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => !!pendingRoute).toBeTruthy();
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toBeDisabled();
  await expect(
    page.getByRole("article", { name: "正在发送的问题" })
  ).toContainText("甲剧的问题");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "切换到乙剧" }).click();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByText("乙剧的角色建议", { exact: true })).toBeVisible();
  await pendingRoute!
    .fulfill({
      json: {
        ...snapshot(),
        messages: [
          {
            id: "late",
            role: "assistant",
            content: "甲剧的迟到回复",
            createdAt: "2026-11-14T00:00:00Z",
          },
        ],
      },
    })
    .catch(() => {});
  await expect(page.getByText("甲剧的迟到回复", { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toHaveValue("");
});

test("首发模型与显示一致，测试失败的默认配置不会被调用，输入限制4000字", async ({
  page,
}) => {
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({
      json: {
        configs: [
          {
            id: "failed-default",
            selectedModel: "wrong-model",
            isDefault: true,
            testStatus: "FAILED",
            provider: {
              id: "failed-provider",
              name: "失败默认模型",
              category: "LLM",
              models: [],
            },
          },
          {
            id: "config-gpt",
            selectedModel: "gpt-test",
            isDefault: false,
            testStatus: "SUCCESS",
            provider: {
              id: "provider",
              name: "GPT测试",
              category: "LLM",
              models: [{ id: "gpt-test", name: "GPT测试模型" }],
            },
          },
        ],
      },
    })
  );
  await page.reload();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "GPT测试模型", exact: true })
  ).toBeVisible();
  await page.route("**/api/assistant/messages", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      projectId: "project-a",
      configId: "config-gpt",
      model: "gpt-test",
      content: "讨论甲剧",
    });
    expect(body.requestId).toMatch(/^[\da-f-]{36}$/);
    await route.fulfill({ json: snapshot() });
  });
  const input = page.getByRole("textbox", { name: "向本剧助手提问" });
  await expect(input).toHaveAttribute("maxlength", "4000");
  await input.fill("讨论甲剧");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input).toHaveValue("");
});

test("配置未指定模型时省略model字段，由服务端解析配置默认模型", async ({
  page,
}) => {
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({
      json: {
        configs: [
          {
            id: "config-no-model",
            selectedModel: null,
            isDefault: true,
            testStatus: "SUCCESS",
            provider: {
              id: "p",
              name: "服务商默认模型",
              category: "LLM",
              models: [],
            },
          },
        ],
      },
    })
  );
  await page.reload();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page
    .getByRole("button", { name: "服务商默认模型", exact: true })
    .click();
  await page
    .getByRole("button", { name: /服务商默认模型.*服务商默认模型.*默认/ })
    .click();
  await page.route("**/api/assistant/messages", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.configId).toBe("config-no-model");
    expect(body).not.toHaveProperty("model");
    await route.fulfill({ json: snapshot() });
  });
  await page
    .getByRole("textbox", { name: "向本剧助手提问" })
    .fill("使用默认模型");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toHaveValue("");
});

test("加载失败可以重试；已有提问处理中时禁止发送并允许刷新", async ({
  page,
}) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({ status: 503, json: { error: "暂时无法载入" } })
  );
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("暂时无法载入");
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({ json: { ...snapshot(), busy: true, hasMore: true } })
  );
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByText(/当前显示最近 40 条消息/)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toBeDisabled();
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({ json: snapshot() })
  );
  await page.getByRole("button", { name: "刷新聊天", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toBeEnabled();
});

test("长历史打开时看到最新消息，成功回复后继续滚到最新", async ({ page }) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const history = Array.from({ length: 40 }, (_, index) => ({
    id: `history-${index}`,
    role: "assistant",
    content: `第${index}条建议\n${"创作建议内容。".repeat(30)}`,
    createdAt: "2026-11-14T00:00:00Z",
  }));
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({ json: { ...snapshot(), messages: history } })
  );
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  const log = page.getByRole("log", { name: "本剧对话" });
  await expect
    .poll(() =>
      log.evaluate((element) =>
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
    )
    .toBeLessThan(5);
  await page.route("**/api/assistant/messages", (route) =>
    route.fulfill({
      json: {
        ...snapshot(),
        messages: [
          ...history.slice(1),
          {
            id: "latest",
            role: "assistant",
            content: "最新回复",
            createdAt: "2026-11-14T00:00:00Z",
          },
        ],
      },
    })
  );
  await page.getByRole("textbox", { name: "向本剧助手提问" }).fill("继续");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("最新回复", { exact: true })).toBeInViewport();
  await expect
    .poll(() =>
      log.evaluate((element) =>
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
    )
    .toBeLessThan(5);
});

test("没有测试成功的文字模型时给出配置入口并禁止发送", async ({ page }) => {
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.reload();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "配置并测试文字模型" })
  ).toHaveAttribute("href", "/settings/ai-models");
  await expect(
    page.getByRole("textbox", { name: "向本剧助手提问" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "发送", exact: true })
  ).toBeDisabled();
});
