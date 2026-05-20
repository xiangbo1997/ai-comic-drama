# In-flight 改动分组提交提议

> **生成时间**：2026-05-20
> **生成者**：Claude Code（受用户委托，代原作者 xiangbo1997 整理 20 个 in-flight 改动）
> **目的**：给原作者一份"按主题拆分的 commit 计划"，原作者可以按此分组提交；也可以选择整体单 commit。
> **状态**：**提议**，未执行任何 `git add` / `git commit` 操作
> **前置背景**：v2 改动已分两个 commit 落盘并推送（`23516d2` docs + `bf905ac` feat）。当前 20 个 in-flight 改动是 v2 的**互补脚手架**，详见 `.claude/v2-conflict-report.md`。

---

## 0. 质量门结果（已跑）

| 检查 | 结果 |
|------|------|
| `pnpm type-check` | ✅ 零错误 |
| `pnpm lint` | ✅ 零警告 |
| `pnpm format:check` | ⚠️ 7 个文件需要 prettier 修复 |

**Prettier 不合规文件清单**：
- `app/src/app/(dashboard)/editor/[id]/hooks/use-generation-actions.ts`
- `app/src/app/(dashboard)/settings/ai-models/components/types.ts`
- `app/src/app/api/ai-models/configs/[id]/test/route.ts`
- `app/src/app/api/generate/tts/route.ts`
- `app/src/services/ai/providers/openai-compatible.ts`
- `app/src/services/generation/image-orchestrator.ts`
- `app/src/services/queue-workers.ts`

**修复方式**：项目已有 husky + lint-staged，**正常 `git commit` 时 pre-commit hook 会自动 `prettier --write` 修复**。如果想提前清理，可以手动跑：
```bash
cd app && pnpm format   # 一次性格式化全部
```

---

## 1. 总览：20 个改动按 6 个语义簇分组

| 簇 | 主题 | 文件数 | 净改动行 | 推荐 commit type |
|----|------|--------|----------|------------------|
| 1 | Flow2API + Veo 视频 provider 全栈接入 | 6 | ~219 行 | ✨ feat(video) |
| 2 | 多参考图（multi-reference）在 image 端打通 | 3 | ~376 行 | ✨ feat(image) |
| 3 | identity seed 在 image providers 下沉 | 6 | ~48 行 | ✨ feat(consistency) |
| 4 | TTS 角色音色一致性 | 2 | ~31 行 | ✨ feat(tts) |
| 5 | Dashboard 鉴权重构（Edge Runtime 安全） | 3 | ~125 行 | ♻️ refactor(auth) |
| 6 | Storage 增加 data URL 支持 | 1 | ~32 行 | ✨ feat(storage) |

**合计**：20 个改动（19 modified + 1 new）。

---

## 2. 簇 1：Flow2API + Veo 视频 provider 全栈接入

### 文件清单
| 文件 | 改动行 | 内容摘要 |
|------|--------|---------|
| `app/src/services/ai/provider-factory.ts` | +9 / -3 | `case "flow2api": return flow2apiVideo;` 注册路由 + openai capability 升级（supportsReferenceImage / supportsMultipleReferences 改为 true, maxReferenceImages 0→4） |
| `app/src/app/(dashboard)/settings/ai-models/components/types.ts` | +13 / -0 | API_PROTOCOLS 数组追加 `{ id: "flow2api", name: "Flow2API (Veo 视频)", defaultBaseUrl: "https://flow2api.cloudsentryai.com", endpoints: { VIDEO: { main: "/v1/chat/completions" } } }` |
| `app/src/app/api/ai-models/configs/[id]/test/route.ts` | +173 / -0 | 新增 `testFlow2apiVideoModel()` —— SSE 探测式连通性测试（真发 stream:true 请求、只读到第一帧 data: 就 abort 关连接），验证 ① HTTP 200 ② SSE 格式正确 ③ 模型 ID 被上游识别 ④ Bearer Key 有效。不消耗用户配额 |
| `app/src/app/api/generate/video/route.ts` | +4 / -0 | API 接收并透传 `aspectRatio` + `referenceImages` 到 `generateVideo({...})` |
| `app/src/services/queue.ts` | +9 / -0 | `addVideoGenerationJob` 接受 `prompt / aspectRatio / referenceImages` 三个新字段 |
| `app/src/services/queue-workers.ts` | +17 / -3 | `handleVideoGeneration` Worker 端透传 `prompt / aspectRatio / referenceImages` 到 `generateVideo({...})` |

### 推荐 commit message

```
✨ feat(video): 接入 Flow2API (Veo 3.1) 视频生成 provider 全栈

provider-factory 注册 flow2api 路由；openai protocol 提升多参考图能力
（maxReferenceImages 0→4）。

AI 模型配置 UI 增加 Flow2API protocol 选项（默认 BaseUrl 指向
https://flow2api.cloudsentryai.com，endpoints.VIDEO 走 /v1/chat/completions）。

新增 testFlow2apiVideoModel：SSE 探测式连通性测试，真发 stream:true 请求
只读到第一帧 data: 就 abort 关连接。验证 ① HTTP 200 ② SSE 格式正确
③ 模型 ID 被上游识别 ④ Bearer Key 有效。任务在 Cloudflare 端立即取消，
不消耗用户配额。

API /generate/video 接收 aspectRatio + referenceImages；队列 layer 透传
到 worker → generateVideo。下游 flow2api-video.ts (已合入 v2 commit
bf905ac) 据此选择 i2v_lite / i2v_s_fast_fl / r2v_fast / t2v_fast 模型路由。
```

---

## 3. 簇 2：多参考图（multi-reference）在 image 端打通

### 文件清单
| 文件 | 改动行 | 内容摘要 |
|------|--------|---------|
| `app/src/services/ai/providers/openai-compatible.ts` | +306 / -8 | 新增 `fetchImageBlob()` 把 data:/http: URL 拉成 multipart Blob；新增 `generateImageWithEdits()` 走 `/v1/images/edits` 多参考图 multipart 上传；新增 `FACE_ANCHOR_SUFFIX` 自动锚定参考图人脸；新增 `isTransientNetworkError()` 重试瞬态网络错误；image 模型识别清单加 `gpt-image-2 / gemini-3-pro-image / -flash-image` |
| `app/src/lib/prompt-builder.ts` | +16 / -2 | `BuildFinalPromptInput` / `BuildFinalPromptOutput` 增加 `referenceImageUrls` 多图字段；`buildFinalPrompt` 合并数组与单图：数组优先；否则把单张包成数组用于服务端 |
| `app/src/app/(dashboard)/editor/[id]/hooks/use-generation-actions.ts` | +54 / -18 | `derivePromptInputs` 改为多角色场景：从 `scene.selectedCharacterIds[]` 映射 `project.characters` 取每个角色的首张参考图；客户端把 `referenceImages` 传给图像/视频 API；视频也复用图像端派生的 `referenceImages` + `aspectRatio` |

### 推荐 commit message

```
✨ feat(image): 多参考图链路从编辑器到 provider 全打通

openai-compatible provider 新增 /v1/images/edits multipart 上传：
- fetchImageBlob 把 data:/http: URL 拉成 Blob 上传
- generateImageWithEdits 用相同字段名 image 重复上传 + image[] 兼容写法
- FACE_ANCHOR_SUFFIX 自动追加"保持参考图脸型/五官/肤色"指令
- isTransientNetworkError 重试瞬态 TCP 断流（ECONNRESET/UND_ERR_SOCKET）
- 识别 gpt-image-2 / gemini-3-pro-image / -flash-image 作为图像模型

prompt-builder.buildFinalPrompt 接受 referenceImageUrls 数组，数组优先；
否则把单张包成数组传给服务端，让 orchestrator 走 reference_edit 策略。

编辑器 derivePromptInputs 改为多角色场景：从 scene.selectedCharacterIds[]
映射 project.characters 取每个角色的首张参考图。视频生成也复用图像端派生的
referenceImages + aspectRatio，让 flow2api-video / Veo 走 R2V / 首尾帧路由。
```

---

## 4. 簇 3：identity seed 在 image providers 下沉

### 文件清单
| 文件 | 改动行 | 内容摘要 |
|------|--------|---------|
| `app/src/services/ai/providers/replicate.ts` | +10 / -2 | flux-kontext-pro + flux-schnell 两个分支都接受 `seed?: number` 透传 + apiKey 校验加强 |
| `app/src/services/ai/providers/fal.ts` | +3 / -1 | falImage 透传 seed |
| `app/src/services/ai/providers/siliconflow.ts` | +3 / -1 | siliconflowImage 透传 seed |
| `app/src/services/ai/providers/proxy-unified.ts` | +2 / -0 | proxyUnifiedImage 透传 seed |
| `app/src/services/generation/image-orchestrator.ts` | +24 / -0 | FNV-1a `hashStringToSeed` —— 同 character.id 每次得到同一 seed；orchestrator 自动从主角色 ID 推导 seed 传给 provider |
| `app/src/services/ai/index.ts` | +6 / -0 | generateImageWithEnvReplicate 提前抛出 REPLICATE_API_TOKEN 未配置错误，给用户清晰提示 |

### 推荐 commit message

```
✨ feat(consistency): identity seed 在 4 个 image providers 下沉 + FNV-1a 推导

image-orchestrator 新增 hashStringToSeed（FNV-1a 32 位无依赖纯函数）：
- 同一 character.id 每次得到同一 [0, 2^31-1) seed
- 跨镜头/跨重试同角色复用相同种子，外貌一致性显著提升
- 没有主角色（纯环境镜头）时不传 seed，让 provider 走默认随机

replicate / fal / siliconflow / proxy-unified 4 个 provider 全部接受
`seed?: number` 入参并透传给上游模型；provider 不支持时静默忽略，
对功能零影响。

REPLICATE_API_TOKEN 未配置时提前抛出友好错误（"请前往 AI 模型配置..."），
避免 401 隐式失败。

下游：services/agents/workflow-engine.ts 已在 v2 commit bf905ac 中
通过 identitySeedFromCharacterId 让视频端复用同一 seed。
```

---

## 5. 簇 4：TTS 角色音色一致性

### 文件清单
| 文件 | 改动行 | 内容摘要 |
|------|--------|---------|
| `app/src/app/api/generate/tts/route.ts` | +23 / -2 | voiceId 优先级链：① 请求显式传入的 voiceId（向后兼容）② 根据 characterId 查 `Character.voiceId`（跨场景音色稳定）③ 兜底 `"default"` |
| `app/src/app/(dashboard)/editor/[id]/page.tsx` | +8 / -2 | 编辑器调 /api/generate/tts 时传 `characterId` 替代 hardcoded `voiceId: "default"` |

### 推荐 commit message

```
✨ feat(tts): 角色音色跨场景一致性 - voiceId 优先级链

API /generate/tts voiceId 解析顺序：
  1) 请求显式传入的 voiceId（最高优先级，向后兼容）
  2) 根据 characterId 查 Character.voiceId（同一角色跨场景音色稳定）
  3) 兜底 "default"（provider 适配器各自映射）

编辑器调用 TTS 时传 characterId（编辑器选中场景的 selectedCharacter.id），
让服务端从 Character.voiceId 自动解析，避免 hardcoded "default" 导致
角色音色随机不一致。
```

---

## 6. 簇 5：Dashboard 鉴权重构（Edge Runtime 安全）

### 文件清单
| 文件 | 改动行 | 内容摘要 |
|------|--------|---------|
| `app/src/middleware.ts` | +27 / -1 | 轻量级 cookie 探测中间件：仅检查 NextAuth session cookie 是否存在，未登录立即 302 跳 /login，登录用户放行进入 Node Runtime 渲染。不引入 Node-only 模块（bcrypt/Prisma/crypto），避免 Edge Runtime 报错 |
| `app/src/app/(dashboard)/layout.tsx` | +26 / -72 | 改为 Server Component：在 Node.js Runtime 执行 `auth()` 鉴权，未登录立即 `redirect("/login")`；通过 server→client 边界把渲染交给 DashboardShell |
| `app/src/app/(dashboard)/dashboard-shell.tsx` | **新建** +75 | Client Component：原来 layout.tsx 里的 `usePathname` 导航 UI 整体迁移到这里（Link / UserMenu / CreditsDisplay / 移动端导航） |

### 推荐 commit message

```
♻️ refactor(auth): Dashboard 鉴权分层，中间件下 Edge Runtime，DB 查询下沉到 RSC

middleware.ts 改为轻量级 cookie 探测：
- 仅检查 NextAuth session cookie 是否存在（__Secure-authjs.session-token /
  authjs.session-token）
- 未登录立即 302 跳 /login，登录用户放行
- 不引入 Node-only 模块（bcrypt/Prisma/crypto），避免 Edge Runtime 报错
- matcher 仍是 /(dashboard)/:path*

(dashboard)/layout.tsx 改为 Server Component：
- 真正的鉴权（DB 查询 + session 解析）在此层
- 未登录立即 redirect("/login")，避免子页面拿到 null user 时崩溃
- 渲染交给 DashboardShell（client 组件）

新建 dashboard-shell.tsx (client)：
- 原 layout.tsx 里的 usePathname 导航 UI 整体迁移
- Link / UserMenu / CreditsDisplay / 移动端导航不变

这是真正的鉴权关口；middleware.ts 只做轻量 cookie 探测、不查 DB。
```

---

## 7. 簇 6：Storage 增加 data URL 支持

### 文件清单
| 文件 | 改动行 | 内容摘要 |
|------|--------|---------|
| `app/src/services/storage.ts` | +32 / -0 | 新增 `parseDataUrl()` 把 `data:image/png;base64,...` 解析为 `{ buffer, mimeType }`；`uploadFromUrl` / `uploadFromUrlToLocal` 在 fetch 前先尝试 parseDataUrl，命中则直接走 buffer 上传路径，跳过 fetch |

### 推荐 commit message

```
✨ feat(storage): uploadFromUrl 支持 data URL 输入

新增 parseDataUrl：把 `data:image/png;base64,...` 解析为 { buffer, mimeType }，
含 base64 / URL-encoded 两种 payload 自动识别。

uploadFromUrl + uploadFromUrlToLocal 在 fetch 前先尝试 parseDataUrl：
- data: URL 命中 → 直接走 buffer 上传，跳过 fetch
- http(s): URL → 走原 fetch 路径

下游场景：image provider 返回 b64_json 时（openai dall-e / gpt-image
等）可以直接传 data URL 给 uploadFromUrl，不必先转 http URL。
```

---

## 8. 推荐执行顺序

由于 6 个簇相对独立、且都已通过 type-check + lint，**任意顺序提交均可**。如果想最大化"可 revert 性"，推荐顺序：

1. **簇 6（storage）** —— 最独立、最小，先打通
2. **簇 5（dashboard auth）** —— 与其他无依赖
3. **簇 3（image seed）** —— 与 v2 commit 同主题，但只动 image 端
4. **簇 1（Flow2API + Veo）** —— 是后续簇 2 的 provider 基础
5. **簇 2（multi-reference）** —— 依赖簇 1 的 capability 升级
6. **簇 4（TTS 音色）** —— 独立但小

或者**全部一起单 commit**：

```
✨ feat: 多参考图 + Flow2API/Veo 视频 + identity seed + 角色音色一致性

(详见下面各簇的 message 拼接)
```

---

## 9. 执行选项

原作者可以选：

| 方案 | 操作 |
|------|------|
| **A. 按 6 个簇分别 commit**（推荐） | 按上面顺序逐簇 `git add <files> && git commit -m "..."`；commit 前 `pnpm format` 解决 prettier warnings 或让 husky 自动修 |
| **B. 整体单 commit** | `git add . && git commit -m "..."`，message 拼接所有簇 |
| **C. 让 Claude Code 代为分组提交** | 用户明确授权后，Claude 按本提议执行 6 次 commit，作者署名仍是 xiangbo1997，commit message 末尾标注 "代为整理提交" |

---

## 10. 给原作者的备忘

- **v2 改动已推送**：`23516d2` docs + `bf905ac` feat。v2 触碰了 4 个文件（types/ai.ts、workflow-engine.ts、video-synthesis.ts、flow2api-video.ts），但只提交了 v2 本身的改动部分；如果原作者本地这 4 个文件还有其他工作，请重新拉取 main 再做。
- **prettier 不需要手动跑**：husky pre-commit hook 会在 `git commit` 时自动 `prettier --write`。
- **质量门已确认通过**：type-check ✅ / lint ✅。可放心提交。
- **建议的 commit type emoji**：feat=✨ / refactor=♻️ / fix=🐛 / docs=📝 / chore=🧑‍💻（与项目现有 commit 风格一致）
