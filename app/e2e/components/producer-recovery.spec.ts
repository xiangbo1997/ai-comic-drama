import { expect, test } from "@playwright/test";
import type { ProducerRunSnapshot } from "@/lib/producer-run";

test("服务端草稿关闭重开与刷新可恢复，重试只执行未完成分镜步骤", async ({
  page,
}, testInfo) => {
  const snapshot: ProducerRunSnapshot = {
    id: "producer-run-1",
    version: 4,
    status: "paused",
    projectId: "saved-project",
    settings: {
      idea: "门外的人来自未来",
      style: "anime",
      aspectRatio: "9:16",
      durationSec: 90,
      genre: "悬疑",
    },
    completedSteps: ["worldview", "project", "script", "characters"],
    createdCharNames: ["阿宁"],
    leaseExpiresAt: null,
    error: null,
    artifact: {
      filmTitle: "门后的自己",
      worldview: "未来的自己穿越到今天",
      protagonist: "阿宁",
      genre: "悬疑",
      durationSec: 90,
      aspectRatio: "9:16",
      style: "anime",
      logline: "阿宁听见自己的敲门声",
      scenes: [
        {
          index: 1,
          title: "敲门",
          description: "阿宁攥紧钥匙，门外传来自己的声音。",
          dialogue: "别开门。",
          narration: null,
          emotion: "fear",
          durationSec: 4,
          characters: ["阿宁"],
        },
      ],
    },
  };
  let listReads = 0;
  let sceneCalls = 0;
  const operationIds: string[] = [];
  const forbidden: string[] = [];
  const actions: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/producer-runs" && request.method() === "GET") {
      listReads++;
      return route.fulfill({ json: [snapshot] });
    }
    if (path === "/api/producer-runs/producer-run-1") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        actions.push(body.action);
        if (body.action === "claim") snapshot.status = "running";
        if (body.action === "release") {
          snapshot.status = body.error
            ? "failed"
            : snapshot.status === "completed"
              ? "completed"
              : "paused";
          snapshot.error = body.error ?? null;
        }
        if (body.action === "finalize") {
          snapshot.status = "completed";
          snapshot.completedSteps = [
            "worldview",
            "project",
            "script",
            "characters",
            "scenes",
          ];
        }
        snapshot.version++;
      }
      return route.fulfill({ json: snapshot });
    }
    if (
      path === "/api/projects/saved-project/scenes" &&
      request.method() === "POST"
    ) {
      sceneCalls++;
      operationIds.push(request.postDataJSON().operationId);
      if (sceneCalls === 1)
        return route.fulfill({
          status: 500,
          json: { error: "模拟分镜网络中断" },
        });
      return route.fulfill({ json: [{ id: "preserved-scene-1" }] });
    }
    forbidden.push(`${request.method()} ${path}`);
    return route.fulfill({
      status: 500,
      json: { error: "不应重新执行已完成步骤" },
    });
  });
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto("/?producer");
  const resume = () => page.getByRole("button", { name: /继续|恢复/ }).first();
  await expect(resume()).toBeVisible();
  await expect(page.getByRole("dialog")).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "打开制片人向导" }).click();
  await expect(resume()).toBeVisible();
  await resume().click();
  await expect(page.getByText(/模拟分镜网络中断/)).toBeVisible();
  await page.reload();
  await expect(resume()).toBeVisible();
  await resume().click();
  await expect(
    page.getByRole("button", { name: "进入审阅", exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("producer-recovered.png"),
  });
  await page.getByRole("button", { name: "进入审阅", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-navigation",
    "/editor/saved-project?review=1"
  );
  expect(listReads).toBeGreaterThanOrEqual(3);
  expect(sceneCalls).toBe(2);
  expect(operationIds).toEqual([
    "producer-scenes:producer-run-1",
    "producer-scenes:producer-run-1",
  ]);
  expect(actions).not.toContain("worldview");
  expect(actions).not.toContain("project");
  expect(actions).not.toContain("script");
  expect(actions).not.toContain("character");
  expect(forbidden).toEqual([]);
});
