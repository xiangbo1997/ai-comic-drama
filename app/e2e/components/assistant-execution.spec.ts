import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssistantExecutionSnapshot } from "@/lib/assistant-execution";
const writeRequests = new WeakMap<Page, string[]>();

function execution(
  overrides: Partial<AssistantExecutionSnapshot> = {}
): AssistantExecutionSnapshot {
  const planSteps = [
    {
      id: "image-1",
      kind: "image" as const,
      label: "生成第1个分镜图片",
      targetId: "scene-1",
      maxCredits: 3,
    },
    {
      id: "repair-1",
      kind: "repair" as const,
      label: "检查并修复人物一致性",
      targetId: "scene-1",
      maxCredits: 3,
    },
  ];
  return {
    id: "execution-a",
    projectId: "project-a",
    status: "planned",
    version: 1,
    plan: {
      fingerprint: "materials-v1",
      configFingerprint: "models-v1",
      steps: planSteps,
      blockers: [],
      estimatedCredits: 6,
      models: {
        image: "测试图片模型",
        video: "测试视频模型",
        llm: "测试检查模型",
      },
      warnings: ["已有图片修复后会保留旧版本"],
      sceneIds: ["scene-1"],
      imageMaxCost: 3,
    },
    options: { maxCredits: 100, maxRepairRounds: 1, generateVideos: true },
    budget: { limit: 100, spent: 0, reserved: 0 },
    steps: planSteps.map((item) => ({ ...item, status: "pending" })),
    repairRounds: 0,
    currentStepId: null,
    error: null,
    requiresAttention: false,
    confirmedAt: null,
    createdAt: "2026-11-14T00:00:00Z",
    updatedAt: "2026-11-14T00:00:00Z",
    ...overrides,
  };
}
async function reopen(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page.getByRole("tab", { name: "自动制作", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  const writes: string[] = [];
  writeRequests.set(page, writes);
  page.on("request", (request) => {
    if (
      request.url().includes("/api/assistant/executions") &&
      request.method() !== "GET"
    )
      writes.push(request.url());
  });
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({
      json: {
        scope: {
          key: "project:project-a",
          type: "project",
          id: "project-a",
          title: "甲剧",
        },
        messages: [],
        memory: { content: "", version: 0 },
      },
    })
  );
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: null } })
  );
  await page.goto("/assistant.html");
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page.getByRole("tab", { name: "自动制作", exact: true }).click();
});

test("打开执行页只读取已有任务，不自动计划或执行", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "当前集自动制作" })
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "最多使用积分" })
  ).toHaveValue("100");
  await expect(
    page.getByRole("combobox", { name: "最多自动修复次数" })
  ).toHaveValue("1");
  await expect(
    page.getByRole("button", { name: "查看执行计划", exact: true })
  ).toBeEnabled();
  expect(writeRequests.get(page)).toHaveLength(0);
});

test("系列总览先选集，空系列说明先新建一集", async ({ page }) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.route("**/api/series/series-a", (route) =>
    route.fulfill({ json: { id: "series-a", title: "系列甲", projects: [] } })
  );
  await page.getByRole("button", { name: "系列助手", exact: true }).click();
  await page.getByRole("tab", { name: "自动制作", exact: true }).click();
  await expect(page.getByText("先新建一集，再让助手执行制作。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看执行计划", exact: true })
  ).toHaveCount(0);
});

test("真实计划显示步骤和模型，确认前不启动，变更预算后必须重新计划", async ({
  page,
}) => {
  let planRequests = 0;
  const actions: string[] = [];
  await page.route("**/api/assistant/executions", async (route) => {
    planRequests++;
    const body = route.request().postDataJSON();
    expect(body.projectId).toBe("project-a");
    expect(body.requestId).toMatch(/^[\da-f-]{36}$/);
    expect(body.options).toMatchObject({
      maxCredits: 100,
      maxRepairRounds: 1,
      generateVideos: true,
    });
    await route.fulfill({ json: { execution: execution() } });
  });
  await page.route("**/api/assistant/executions/execution-a", async (route) => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    await route.fulfill({
      json: {
        execution: execution({
          status: "running",
          confirmedAt: "2026-11-14T00:01:00Z",
        }),
      },
    });
  });
  await page.getByRole("button", { name: "查看执行计划", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "生成第1个分镜图片" })
  ).toBeVisible();
  await expect(
    page.getByText("图片：测试图片模型", { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/预计最多 6 积分/)).toBeVisible();
  expect(planRequests).toBe(1);
  expect(actions).toHaveLength(0);
  await page.getByRole("spinbutton", { name: "最多使用积分" }).fill("50");
  await expect(
    page.getByRole("button", { name: "确认并开始后台制作", exact: true })
  ).toBeDisabled();
  await page.getByRole("spinbutton", { name: "最多使用积分" }).fill("100");
  await page
    .getByRole("button", { name: "确认并开始后台制作", exact: true })
    .dblclick();
  await expect(page.getByRole("status")).toContainText("后台制作中");
  expect(actions).toEqual(["confirm"]);
});

test("关面板后重新打开恢复后台任务，停止等待服务端确认", async ({ page }) => {
  let current = execution({
    status: "running",
    budget: { limit: 100, spent: 3, reserved: 3 },
    version: 2,
  });
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: current } })
  );
  const actions: string[] = [];
  await page.route("**/api/assistant/executions/execution-a", async (route) => {
    actions.push(route.request().postDataJSON().action);
    current = { ...current, status: "stopping", version: 3 };
    await route.fulfill({ json: { execution: current } });
  });
  await reopen(page);
  await expect(page.getByRole("status")).toContainText("后台制作中");
  await expect(page.getByText("3 / 100", { exact: true })).toBeVisible();
  await reopen(page);
  expect(actions).toHaveLength(0);
  await page.getByRole("button", { name: "停止后续步骤", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("正在停止后续步骤");
  await expect(
    page.getByRole("button", { name: "正在停止…", exact: true })
  ).toBeDisabled();
  current = { ...current, status: "stopped", version: 4 };
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已停止后续步骤");
  expect(actions).toEqual(["stop"]);
});

test("余额恢复后可继续暂停任务，保留累计费用和修复次数", async ({ page }) => {
  const current = execution({
    status: "paused",
    requiresAttention: true,
    budget: { limit: 100, spent: 9, reserved: 0 },
    repairRounds: 1,
    error: "积分余额不足，请补充余额后继续",
  });
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: current } })
  );
  await reopen(page);
  await expect(page.getByText("9 / 100", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/有生成任务的结果尚未确认/)).toHaveCount(0);
  await page.route("**/api/assistant/executions/execution-a", async (route) => {
    expect(route.request().postDataJSON().action).toBe("resume");
    expect(route.request().postDataJSON()).not.toHaveProperty("options");
    await route.fulfill({
      json: { execution: { ...current, status: "running", error: null } },
    });
  });
  await page
    .getByRole("button", { name: "继续未完成步骤", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("后台制作中");
  await expect(page.getByText("9 / 100", { exact: true })).toBeVisible();
});

test("检查未通过且修复次数耗尽时可重新计划，不能直接继续", async ({ page }) => {
  const current = execution({
    status: "paused",
    requiresAttention: true,
    resumeBlocked: true,
    repairRounds: 1,
    error: "自动修复次数已用完，请检查素材后重新计划",
  });
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: current } })
  );
  await reopen(page);
  await expect(page.getByText(/有生成任务的结果尚未确认/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "继续未完成步骤", exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "重新查看计划", exact: true }).click();
  await page.route("**/api/assistant/executions", async (route) => {
    expect(route.request().postDataJSON().projectId).toBe("project-a");
    await route.fulfill({
      json: { execution: execution({ id: "replacement-plan" }) },
    });
  });
  await page.getByRole("button", { name: "查看执行计划", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "执行计划 · 等待你的确认" })
  ).toBeVisible();
});

for (const status of ["failed", "stopped"] as const) {
  test(`${status}终态只能重新计划，不展示服务端不支持的继续操作`, async ({
    page,
  }) => {
    await page.route("**/api/assistant/executions?**", (route) =>
      route.fulfill({
        json: { execution: execution({ status, requiresAttention: true }) },
      })
    );
    await reopen(page);
    await expect(
      page.getByRole("button", { name: "继续未完成步骤", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "重新查看计划", exact: true })
    ).toBeVisible();
    await expect(page.getByText(/有生成任务的结果尚未确认/)).toHaveCount(0);
  });
}

test("暂停任务有失败步骤时须重新计划，尚在执行的步骤则先核对结果", async ({
  page,
}) => {
  let current = execution({
    status: "paused",
    requiresAttention: true,
    steps: [
      {
        id: "failed-step",
        kind: "image",
        label: "生成图片",
        maxCredits: 3,
        status: "failed",
      },
    ],
  });
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: current } })
  );
  await reopen(page);
  await expect(
    page.getByRole("button", { name: "继续未完成步骤", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新查看计划", exact: true })
  ).toBeVisible();
  current = { ...current, steps: [{ ...current.steps[0], status: "running" }] };
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续未完成步骤", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新查看计划", exact: true })
  ).toHaveCount(0);
});

test("未知生成结果不允许继续，保留查看结果入口", async ({ page }) => {
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({
      json: {
        execution: execution({
          status: "paused",
          requiresAttention: true,
          steps: [
            {
              id: "unknown",
              kind: "image",
              label: "生成图片",
              maxCredits: 3,
              status: "unknown",
              taskId: "unconfirmed-task",
            },
          ],
        }),
      },
    })
  );
  await reopen(page);
  await expect(page.getByText(/有生成任务的结果尚未确认/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续未完成步骤", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新查看计划", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "查看本集结果" })
  ).toHaveAttribute("href", "/editor/project-a");
});

test("计划有阻塞条件或确认遇到素材变化，都禁止直接执行", async ({ page }) => {
  let planned = execution({
    plan: { ...execution().plan, blockers: ["请先配置图片模型"] },
  });
  await page.route("**/api/assistant/executions", (route) =>
    route.fulfill({ json: { execution: planned } })
  );
  await page.getByRole("button", { name: "查看执行计划", exact: true }).click();
  await expect(
    page.getByText("· 请先配置图片模型", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认并开始后台制作", exact: true })
  ).toBeDisabled();
  planned = execution({ id: "execution-b" });
  await page
    .getByRole("button", { name: "重新查看执行计划", exact: true })
    .click();
  await page.route("**/api/assistant/executions/execution-b", (route) =>
    route.fulfill({ status: 409, json: { error: "素材已经变化" } })
  );
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: planned } })
  );
  await page
    .getByRole("button", { name: "确认并开始后台制作", exact: true })
    .click();
  await expect(page.getByText(/当前素材或计划已变化/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认并开始后台制作", exact: true })
  ).toBeDisabled();
});

test("系列选择不同集后读取各自任务，不启动其他集", async ({ page }) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.route("**/api/series/series-a", (route) =>
    route.fulfill({
      json: {
        projects: [
          { id: "episode-a", title: "第一集", episodeNumber: 1 },
          { id: "episode-b", title: "第二集", episodeNumber: 2 },
        ],
      },
    })
  );
  const reads: string[] = [];
  await page.route("**/api/assistant/executions?**", (route) => {
    reads.push(new URL(route.request().url()).searchParams.get("projectId")!);
    return route.fulfill({ json: { execution: null } });
  });
  await page.getByRole("button", { name: "系列助手", exact: true }).click();
  await page.getByRole("tab", { name: "自动制作", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看执行计划", exact: true })
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "选择要制作的一集" })
    .selectOption("episode-b");
  await expect(page.getByText("第二集", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看执行计划", exact: true })
  ).toBeVisible();
  expect(reads).toEqual(["episode-b"]);
});

test("切集时隔离尚未返回的执行状态", async ({ page }) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.route("**/api/series/series-a", (route) =>
    route.fulfill({
      json: {
        projects: [
          { id: "episode-a", title: "第一集", episodeNumber: 1 },
          { id: "episode-b", title: "第二集", episodeNumber: 2 },
        ],
      },
    })
  );
  let delayed: Route | undefined;
  await page.route("**/api/assistant/executions?**", (route) => {
    const projectId = new URL(route.request().url()).searchParams.get(
      "projectId"
    );
    if (projectId === "episode-a") {
      delayed = route;
      return;
    }
    return route.fulfill({
      json: {
        execution: execution({
          id: "run-b",
          projectId: "episode-b",
          status: "completed",
          budget: { limit: 100, spent: 12, reserved: 0 },
        }),
      },
    });
  });
  await page.getByRole("button", { name: "系列助手", exact: true }).click();
  await page.getByRole("tab", { name: "自动制作", exact: true }).click();
  const select = page.getByRole("combobox", { name: "选择要制作的一集" });
  await select.selectOption("episode-a");
  await expect.poll(() => !!delayed).toBeTruthy();
  await select.selectOption("episode-b");
  await expect(page.getByRole("status")).toContainText("制作已完成");
  await delayed!
    .fulfill({
      json: {
        execution: execution({
          projectId: "episode-a",
          status: "failed",
          error: "第一集的迟到错误",
        }),
      },
    })
    .catch(() => {});
  await expect(page.getByText("第一集的迟到错误", { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByText("12 / 100", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "查看本集结果" })
  ).toHaveAttribute("href", "/editor/episode-b");
});

test("进度连接失败提示状态未知，恢复后从后台读取真实结果", async ({ page }) => {
  let unavailable = false;
  let current = execution({ status: "running", version: 2 });
  await page.route("**/api/assistant/executions?**", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "进度连接暂时中断" } })
      : route.fulfill({ json: { execution: current } })
  );
  await reopen(page);
  await expect(page.getByRole("status")).toContainText("后台制作中");
  unavailable = true;
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("后台状态尚未确认", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "查看执行计划", exact: true })
  ).toHaveCount(0);
  expect(writeRequests.get(page)).toHaveLength(0);
  current = execution({
    status: "completed",
    version: 3,
    budget: { limit: 100, spent: 6, reserved: 0 },
  });
  unavailable = false;
  await page
    .getByRole("button", { name: "刷新任务", exact: true })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("制作已完成");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("6 / 100", { exact: true })).toBeVisible();
  expect(writeRequests.get(page)).toHaveLength(0);
});
