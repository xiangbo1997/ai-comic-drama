/**
 * 冒烟 E2E：覆盖「落地页 → 登录/注册 → 项目列表 → 编辑器」关键路径。
 *
 * 原则：
 * - 每条用例自包含（自己注册专属账号），无跨用例状态依赖
 * - 断言用户可见文案/角色，不绑内部实现细节
 * - 只验证"路径可达 + 关键引导存在"，不触发真实 AI 生成（无 Key 也能跑）
 */

import { test, expect, type Page } from "@playwright/test";

/** 注册一个一次性账号并等待自动登录跳转完成 */
async function registerFreshUser(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.getByRole("button", { name: "注册", exact: true }).first().click();
  await page.getByPlaceholder("example@studio.com").fill(email);
  await page.getByPlaceholder("设置密码（至少6位）").fill("e2e-password-123");
  // 页面上有两个"注册"按钮（Tab 切换 + 表单提交），用 type=submit 精确定位
  await page.locator('form button[type="submit"]').click();
  return email;
}

test("落地页渲染：标题与开始创作入口", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI 漫剧工作台" })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "开始创作" })).toBeVisible();
});

test("登录页渲染：双 Tab、表单字段与条款链接可达", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "登录", exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "注册", exact: true }).first()
  ).toBeVisible();
  await expect(page.getByPlaceholder("example@studio.com")).toBeVisible();

  // 条款/隐私是真实页面而非死链（ux 整改验证）
  await page.getByRole("link", { name: "服务条款" }).click();
  await expect(page).toHaveURL(/\/terms/);
  await expect(page.getByRole("heading", { name: "服务条款" })).toBeVisible();
});

test("未登录访问受保护页被踢到登录页并携带 callbackUrl", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
});

test("注册后自动登录，项目空态展示三步指引", async ({ page }) => {
  await page.goto("/login");
  await registerFreshUser(page);

  await expect(page).toHaveURL(/\/projects/, { timeout: 30_000 });
  await expect(page.getByText("还没有项目")).toBeVisible();
  // 首跑教育（ux 整改验证）：空态包含配置 AI 模型的指引
  await expect(page.getByText("三步开始创作")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "设置 › AI 模型配置" })
  ).toBeVisible();
});

test("登录尊重 callbackUrl：深链登录后回到原页面", async ({ page }) => {
  // 未登录访问 /credits → 被踢到 /login?callbackUrl=/credits →
  // 注册（同样走 redirectTarget）→ 应落回 /credits 而非 /projects
  await page.goto("/credits");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcredits/);
  await registerFreshUser(page);

  await expect(page).toHaveURL(/\/credits/, { timeout: 30_000 });
  await expect(page.getByText("当前积分")).toBeVisible();
  // 积分明细区块存在（ux 整改验证）
  await expect(page.getByText("积分明细")).toBeVisible();
});

test("新建项目进入编辑器：三栏可达且未配模型时出现引导卡", async ({ page }) => {
  await page.goto("/login");
  await registerFreshUser(page);
  await expect(page).toHaveURL(/\/projects/, { timeout: 30_000 });

  await page.getByRole("button", { name: "新建项目" }).first().click();
  await expect(page).toHaveURL(/\/editor\//, { timeout: 30_000 });

  // 左栏输入区
  await expect(page.getByText("输入文本")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: /智能拆解分镜/ })
  ).toBeVisible();
  // AI 配置墙前置引导卡（ux 整改验证）：新账号未配 LLM 必然出现
  await expect(page.getByText("开始创作前，请先配置 AI 模型")).toBeVisible();
  await expect(page.getByRole("link", { name: /前往配置模型/ })).toBeVisible();
  // 中栏空态引导
  await expect(page.getByText("暂无分镜")).toBeVisible();
});
