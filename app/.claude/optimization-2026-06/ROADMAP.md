# AI 漫剧工作台 — 全面优化总路线图

> 10 agent 并行分析汇总（2026-06-19）。四维：用户体验 / 性能 / 架构 / 功能。
> 源报告见 `agents/*.md`。本文做交叉去重 + ROI 排序 + 方案裁决。

## 一、30 个 P0 收敛到 4 个根因

多个独立 agent 撞到同一病灶 → 说明是系统性根因，不是孤立 bug。

### 根因 A：核心链路在接缝处断裂（用户花了积分却拿不到产物）

| 断点                                                              | 证据                                       | 报告               | 状态            |
| ----------------------------------------------------------------- | ------------------------------------------ | ------------------ | --------------- |
| 导出无产物（R2未配 videoUrl 丢失）                                | export/route.ts                            | (本会话)           | ✅ 已修 21bce68 |
| 一键成片是**哑片**（TTS 音频 Buffer 扔了，从不写 scene.audioUrl） | workflow-engine.ts:619-636                 | feat-creative P0-1 | 🔴 待修         |
| 新用户**第一步即死路**（无 key→400，错误被吞成"请重试"）          | script/parse:62-67, ScriptPanel:99-103     | ux-onboarding P0   | 🔴 待修         |
| Workflow 路径**全程不扣费**（白嫖）                               | workflow/route.ts, workflow-engine:248-262 | reliability P0-2   | 🔴 待修         |

### 根因 B：队列子系统是死代码 → 同步阻塞 + 僵尸任务（三重印证）

perf-backend / reliability / arch-services 独立指出：BullMQ 队列/worker 全是死代码，真实生成走"游离 Promise + 同步阻塞"。
| 后果 | 证据 | 报告 |
|------|------|------|
| 生成在 HTTP 请求里同步跑（图10-60s/视频2-5min 阻塞） | generate/image, generate/video | perf-backend P0 |
| 导出 fire-and-forget 不走队列 | export/route processExportAsync | perf-backend P0 |
| **僵尸任务**：进程重启在途任务全丢，DB 永久 PROCESSING，前端无限轮询 | page.tsx:180 无 maxAttempts | reliability P0-1 |
| executeWorkflow 早期异常 → 永久卡 PENDING | workflow-engine | reliability P0-3 |
| 资产下载无超时，单个挂死 URL 拖死导出 | video-synthesis:184 | reliability P0-4 |

### 根因 C：数据与资金无保护

| 问题                                                                    | 证据                    | 报告                                                       |
| ----------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| 分镜批量保存"删全建全+非事务"→中断丢全部分镜及已生成图/视频             | scenes/route.ts:135-176 | arch-data P0-1 **+** perf-backend P0(N+1 150次往返) 双印证 |
| 删 User 级联硬删 Order/CreditTransaction/Subscription→毁资金审计账本    | schema L52/450/499      | arch-data P0-2                                             |
| GenerationTask 无FK/无userId/无索引→孤儿表无限膨胀+无法按用户回查退款   | schema L350-369         | arch-data P0-3 + perf-backend(缺索引)                      |
| IDOR：生成端点信任 body.sceneId 不校验归属→跨用户篡改/投毒              | generate/image:135,375  | security-cost P0-1                                         |
| SSRF：downloadFile 下载任意 URL（scene.\*Url 用户可写）→打云元数据/内网 | video-synthesis:184     | security-cost P0-2                                         |
| 上传无 content-type/大小白名单→SVG/HTML 存储型XSS + 磁盘DoS             | upload:41-53            | security-cost P0-3                                         |

### 根因 D：前端 memo 击穿 → 全量重渲染

| 问题                                                                                        | 证据                           | 报告               |
| ------------------------------------------------------------------------------------------- | ------------------------------ | ------------------ |
| SceneList/TimelineEditor 的 memo 被内联对象 props 击穿，17个弹窗任一开关全量重渲染20-40卡片 | page.tsx:331-347               | perf-frontend P0-1 |
| 批量生成每张图都 invalidateProject()（20张=40次全量重拉）                                   | use-generation-actions:282,303 | perf-frontend P0-2 |

---

## 二、方案分歧裁决

**配乐数据建模之争**：arch-data 主张三表 schema（BgmTrack/ProjectBgm/SceneBgm + 枚举）；feat-bgm 主张内置曲库走静态清单不入 DB，只把选中配置存进 generationParams.backgroundMusic。

- **裁决：采用 feat-bgm 的轻量方案做 MVP。** 内置曲库是固定静态资产（public/bgm/<分类>/\*.mp3 + lib/bgm-library.ts 清单），不必入库；用户选中的 BGM 配置存进 generationParams.backgroundMusic（与 watermark/stickers 同模式）。arch-data 的三表 schema 留作"用户自建歌单/曲目元数据检索"等未来需求。理由：最小改动、与现有 generationParams 模式一致、不引入 migration 风险。

---

## 三、实施路线（按 ROI 排序，分批交付）

### 批次 0 — 配乐功能（用户硬需求，独立交付）

按 feat-bgm 方案：types BackgroundMusic 字段 → public/bgm 曲库 + lib/bgm-library.ts → video-synthesis amix 接入(volume+aloop+atrim+afade+可选 ducking) → **白名单 normalizeGenerationParams 加 backgroundMusic（防第三次踩坑）** → export route 透传 → BgmDialog/BgmPanel UI → preview-player 加 BGM audio 轨。
依赖：用户上传分支依赖"批次1 上传白名单"先修。内置曲库分支无依赖，可先做。

### 批次 1 — 止血（S级，零/低架构风险，最高 ROI）

1. 哑片修复：workflow-engine 写回 scene.audioUrl（feat-creative P0-1，S，半天）
2. 新手转化：**平台默认 AI 配置（做成可配置项，复用 AIProvider/UserAIConfig 体系，不写死供应商）** + 用户无 key 时 fallback + 错误透传（ux-onboarding P0）+ **消费上限护栏**（security-cost P1，兜底必须配护栏防薅穿）
   - 决策（2026-06-20 用户）：兜底 key 像 AI 模型配置一样可在设置里配，平台级默认配置，用户没配自己的就用它
3. 僵尸任务回收 + 前端轮询超时（reliability P0-1，止血版）
4. 分镜批量保存重写为事务 + diff-upsert（arch-data P0-1 + perf-backend，一次解决数据安全+N+1）
5. 上传白名单（content-type+大小，security-cost P0-3，配乐上传前置）
6. IDOR 校验 sceneId 归属（security-cost P0-1）
7. SSRF 防护：downloadFile 限制内网/元数据 IP（security-cost P0-2）
8. 补索引：Scene/GenerationTask（perf-backend + arch-data）

### 批次 2 — 体验与性能（S~M）

1. memo 击穿修复 + 批量刷新去抖（perf-frontend P0，一个 PR）
2. 时间轴播放联动 + 切换分镜 scrollIntoView（ux-editor P0-1/P0-2）
3. 移动端响应式（ux-editor P0-3）
4. Workflow 扣费（reliability P0-2，资金漏洞）

### 批次 3 — 标杆差异化（M~L）

1. **角色一致性闭环**（feat-creative：定妆三视图 i2i 绑定→canonical 锚点→跨分镜 seed 复用→Face Validator 真校验）—— 漫剧核心壁垒
2. 镜头语言四字段落地（cameraAngle/lighting/composition/colorPalette）
3. 删 User 改软删/保留资金账本（arch-data P0-2）

### 批次 4 — 架构根治（L，需决策）

1. 配 REDIS_URL 启用真异步队列（根因 B 根治，perf-backend+reliability）
2. 拆两个巨型测试路由 1356+1115 行（arch-services P0-1）
3. 删 sdk.ts 死代码 + 循环依赖（arch-services P0-2）

---

## 四、统计

- 10 agent，30 个 P0 + 大量 P1/P2
- 资金核心链路（R1-R7）复核**全部到位**，无新增资金 P0（好消息）
- 死代码发现：Zustand（零引用）、BullMQ 队列子系统、sdk.ts、refundCredits 无调用方
