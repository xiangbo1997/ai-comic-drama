# 漫剧质量优化三特性 — 实施计划（2026-07-12，Claude Code）

目标：1) 视频时长按模型能力自动分段，杜绝凑时长 2) 系列级永久记忆（故事圣经）3) 爆款方法论注入 prompt 层。
依据：5-agent 侦察工作流 + 竞品/爆款/动漫工业三路调研（证据见各 agent 报告，file:line 已核）。

## WS1 时长分段（先行）

- 新增 `VIDEO_PROVIDER_CAPABILITIES`（对齐 IMAGE_PROVIDER_CAPABILITIES 模式）：
  nativeClipSeconds（Veo≈8）/ requestableDurations / acceptsDurationParam（flow2api=false）/ supportsFirstLastFrame / maxChainSegments
- 新增 `services/generation/video-segmenter.ts`：planVideoSegments(duration, cap)；≤单段能力则退化为现行为
- 视频生成任务路径改造（api/generate/video）：
  分段循环 = 段k生成 → safeDownload → ffmpeg 抽尾帧（-sseof）→ storage 上传 → 作段k+1首帧（I2V/FL）→ ffmpeg concat 归一转码 → 单一 videoUrl 落库
  videoLinkNext 尾帧只作用于最后一段；实测总时长回写；GenerationTask.output.segments 留痕
- video-director 扩展 segmentCount：一次导演产出各段 actionBeat（zod 数组，失败回退均摊）
- 计费：按段位阶梯求和（沿用 ceil(d/5)*10 语义）；5/10/15 白名单 400 校验 → 1-60 范围 + 服务端计划
- 全局一致性修复：nearestVideoDuration 双实现统一为单一导出；scenes POST/PATCH 服务端 clamp；workflow 路径补 probe 回写 duration

## WS2 故事圣经（次行）

- Schema：`Series.storyBible Json @default("{}")`（加法变更，db push 安全）
- 结构（types + zod）：canon{worldview/tone/locations/props} + characters{state/relationships/arc} + threads{status/plantedEp} + episodes{logline/endingHook/hookType/endingFrameDescription/newLore}
- Chronicler（史官，pattern-copy video-director：低温/zod/静默失败）：剧本应用到分镜、分镜批量保存两处触发（fire-and-forget，按 series 防并发）
- Reader 收口 lib/series.ts：buildSeriesMemoryDigest(bible,{stage:'script'≈2000字|'scene'≈600字})，取代 derivePreviousEpisodeRecap / deriveVideoSeriesRecap（空圣经回退旧 recap）
- 注入四点：① 双解析 prompt 加 seriesContext（最大缺口）② drama-script recapBlock 累积化 ③ video-director seriesRecap（缓存自动失效）④ 图像分析 + 必须同步扩 AnalysisCacheKeyInput
- API 暴露 GET/PATCH storyBible；UI 最小可见

## WS3 方法论 prompt 层（末行）

- 新增 `lib/prompts/episode-structure.ts` 单源，供双解析/drama-script/九宫格共用
- 规则：冷开场钩子｜黄金3秒台词｜节奏骨架(3s钩→30s爽点→60s爆发→尾钩)｜每15-20s微爽点｜集尾五类钩子轮换(读圣经 hookType 历史，连续3集禁同型)｜台词12-18句/分｜打脸四步｜单镜2-3s、>5s须有理由｜反转急推特写
- 时长诚实：删「之和应接近目标总时长」→ ±20% 容差+禁止注水+系统自动分段；sceneCount 公式 → beat 制
- 第一集也强制尾钩；zod 加 hookType/cliffhangerType（.catch 兜底）；narrative-review 加 hook_strength/cliffhanger 维度（默认关）

## 执行

顺序：WS1 → WS2 → WS3（video/route.ts、workflow-engine.ts、prompt 文件重叠，禁止并行写同文件）。
每 WS 派 Opus 子代理实施，主会话评审；全部完成后 pnpm ci 全绿 → SSH 上线（db push + restart）。
基线：本地 == 服务器（commit 7826bef + 未提交 07-11 改动，哈希已比对一致）。

## 暂缓清单（本轮不做，已记录依据）

VLM 择优抽卡闭环（P0 级但工程量大）/ 道具线索追踪 / 宫格拆首尾帧 / 词级字幕高亮 / 剪映草稿导出 / 元素标脏+版本回滚
