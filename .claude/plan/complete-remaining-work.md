# 📋 实施计划：完成项目剩余工作

## 项目现状

项目完成度约 95%。经全面扫描，剩余工作分为 **3 个核心缺口** 和 **2 个加固项**。

---

## 任务类型
- [x] 前端
- [x] 后端
- [x] 全栈

---

## 一、核心缺口（必须完成）

### Task 1：视频/TTS 多 Provider 分发（后端）

**问题**：`generateVideo()` 硬编码 Runway，`synthesizeSpeech()` 硬编码 Volcengine，不走 `UserAIConfig` 系统。

**方案**：复用 `chatCompletion()` / `generateImage()` 已验证的模式。

**实施步骤**：

1. **修改 `services/ai.ts`** — `generateVideo()`
   - 新增 `config?: AIServiceConfig` 参数
   - 按 protocol 分发：`runway`（现有逻辑）、`fal`（Fal.ai）、`proxy-unified`（通用代理）
   - 无 config 时 fallback 到环境变量（保持向后兼容）

2. **修改 `services/ai.ts`** — `synthesizeSpeech()`
   - 新增 `config?: AIServiceConfig` 参数
   - 按 protocol 分发：`volcengine`（现有逻辑）、`elevenlabs`
   - 无 config 时 fallback 到环境变量

3. **修改 `api/generate/video/route.ts`**
   - 导入 `getUserVideoConfig()`
   - 获取用户视频配置，传入 `generateVideo()`

4. **修改 `api/generate/tts/route.ts`**
   - 导入 `getUserTTSConfig()`
   - 获取用户 TTS 配置，传入 `synthesizeSpeech()`

**影响文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/ai.ts` | 修改 | generateVideo/synthesizeSpeech 添加 config 分发 |
| `src/app/api/generate/video/route.ts` | 修改 | 注入 getUserVideoConfig |
| `src/app/api/generate/tts/route.ts` | 修改 | 注入 getUserTTSConfig |

**预计改动**：~200-300 行

---

### Task 2：多版本批量生成（全栈）

**问题**：编辑器 3 处 `MultiGenerateDialog` 的 `onGenerate` 回调只有 `console.log`。

**方案**：对每个 config 并行调用对应的 generate API，收集结果让用户选择。

**实施步骤**：

1. **编辑器页面 `editor/[id]/page.tsx`** — 实现 3 个 `onGenerate` 回调：
   - **多版本图片生成**（L1278-1282）：对 configs 数组中每项，并行调用 `/api/generate/image`，将结果存入 scene 的候选列表
   - **多版本视频生成**（L1288-1292）：并行调用 `/api/generate/video`
   - **多版本配音生成**（L1298-1302）：并行调用 `/api/generate/tts`

2. **状态管理**：在编辑器中添加 `multiGenerateResults` 状态，跟踪批量生成进度和结果

3. **结果展示**：生成完成后，用户可在场景面板中查看/对比/选择最佳版本

**影响文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/app/(dashboard)/editor/[id]/page.tsx` | 修改 | 实现 3 个 onGenerate 回调 |

**预计改动**：~100-150 行

---

### Task 3：Next.js Middleware 路由保护（前端）

**问题**：无全局 middleware，未登录用户可直接访问 `/projects`、`/editor/*` 等页面（虽然 API 会 401，但体验不佳）。

**实施步骤**：

1. **创建 `src/middleware.ts`**：
   - 使用 NextAuth v5 的 `auth` wrapper
   - 匹配 `/(dashboard)/*` 路由
   - 未登录重定向到 `/login`
   - 排除 `/api`、`/_next`、静态资源

**影响文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/middleware.ts` | 新建 | 全局路由保护 |

**预计改动**：~30 行

---

## 二、加固项（建议完成）

### Task 4：`next.config.ts` 图片域名配置

**问题**：AI 生成的图片来自外部域名（Fal.ai CDN、Replicate、SiliconFlow 等），Next.js `<Image>` 组件会拒绝未配置的远程域名。

**实施步骤**：

1. **修改 `next.config.ts`**：添加 `images.remotePatterns`，覆盖 R2 bucket 域名和主要 AI 图片 CDN

**影响文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `next.config.ts` | 修改 | 添加 remotePatterns |

**预计改动**：~20 行

---

### Task 5：构建验证

**实施步骤**：

1. 运行 `pnpm ci`（type-check + lint + format:check + build）确认所有改动无回归

---

## 三、实施顺序

```
Task 1（视频/TTS 多 Provider）  ← 后端基础，Task 2 依赖
    ↓
Task 2（多版本批量生成）        ← 编辑器功能补全
    ↓
Task 3（Middleware 路由保护）    ← 独立，可并行
Task 4（next.config 图片域名）  ← 独立，可并行
    ↓
Task 5（构建验证）              ← 最终验证
```

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 新 provider API 格式未知 | 基于现有 protocol 枚举实现，fallback 到 env vars |
| 多版本生成并发量大 | 复用现有 rate-limit 机制，每个请求独立限流 |
| middleware 影响 API 路由 | matcher 精确排除 `/api/*` |

---

## SESSION_ID（供 /ccg:execute 使用）
- CODEX_SESSION: N/A（本次未调用外部模型）
- GEMINI_SESSION: N/A（本次未调用外部模型）
