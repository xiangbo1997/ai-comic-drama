# 漫剧质量对标优化 2026-07-19

> 来源：9-agent 工作流（4 联网调研 + 4 代码审计 + 1 综合），完整原始数据见同目录 `research-audit-full.json`。执行者：Claude Code（Fable 5 主会话规划验收 + Opus 4.8 子代理实施）。

## 差距矩阵（真实漫剧 vs 现状）

| 维度       | 真实漫剧标准                           | 我们现状                                                              | 差距 |
| ---------- | -------------------------------------- | --------------------------------------------------------------------- | ---- |
| 剪辑节奏   | 0.5-6s三档快切，每分钟15-25镜          | shot-timing的1-4s被档位吸附成5-8s并实测反写DB；2s对白配8s画面哑口空拍 | 致命 |
| 转场语言   | 90%硬切+爆点闪白/闪黑，叠化禁忌        | 默认全片0.3s叠化；LLM的transition字段在drama-to-scenes被丢弃          | 致命 |
| 音效设计   | 每镜卡点SFX+环境音床+四层混音-16LUFS   | 零SFX资产/零混音路径；amix缺normalize=0                               | 致命 |
| 配音表演   | 逐句情绪、1.1-1.2x语速、分声线         | workflow不传voiceId全员女声；Scene.emotion落库但TTS零消费             | 致命 |
| 对白嘴动   | 模糊lip flap即达标                     | video-prompt硬编码"no lip-sync"，闭嘴配画外音                         | 高   |
| 冲击语汇   | 震屏/冲击帧/速度线/拟声字卡            | 全仓零命中；图片分镜-loop 1死帧                                       | 高   |
| 关键帧表现 | 夸张表情+漫画符号+构图变化             | 情绪压成"sad mood"两词；镜头四字段权重最低且workflow路径丢弃          | 高   |
| 成片包装   | 片头卡+下集钩子卡+统一调色+花字        | 无片头尾卡；ASS硬编码Arial；无LUT                                     | 中   |
| 节拍验收   | 3s炸点/30s情绪事件可机检；红果2026红线 | 有方法论prompt无数字门禁                                              | 中   |

## 批次（各自独立可交付）

- **批1 (P0/L)** 声音设计从零到一：sfx-library.ts + public/sfx CC0资产 + 分镜sfx标签 + video-synthesis第三音轨 + amix normalize=0修复 + loudnorm + ducking默认开 + 预览端sfx调度
- **批2 (P0/M)** 剪辑节奏回归：segmented-video按目标时长裁剪 + duration反写修正 + 硬切默认/闪白闪黑 + drama-to-scenes透传transition + FL分支保留运镜
- **批3 (P0/M)** 配音表演：workflow声线断链修复 + 旁白独立声线 + TTSOptions.emotion透传(火山/11labs) + lip flap指令放开 + 字幕窗对齐配音实长
- **批4 (P1/L)** 冲击表现力：zoompan救活死帧 + shake/flash/freeze + 速度线/拟声字贴图(fx-overlays) + beatType→效果映射 + 变速playbackRate parity
- **批5 (P1/M)** 关键帧漫剧化：emotion-grammar.ts + prompt-builder段序重排 + 竖屏构图基线 + SHOT_MAP三维词表 + observer加visual_impact + style-packs英文精简版
- **批6 (P1/M)** 成片包装：片头/片尾卡 + 思源黑体/得意黑 + LUT全片调色 + 金句花字 + producer-review红果红线数字门禁

执行序：Wave1 = 批2∥批5（文件不相交）→ 批3 → 批1 → 批4 → 批6（video-synthesis.ts/preview-player.tsx 为枢纽文件，串行避竞写）。

> **状态（2026-07-20，Claude Code）**：六批全部上线收官。批2=2792196 / 批5=1dac5be / 批3=5ea8180 / 批1=d1baa3f / 批4=d2a9d8b / 批6=f17c40f（成片包装：片头尾卡+思源黑体/得意黑+金句花字+全片LUT+红果红线门禁，零 schema 变更）。批6 契约单一真源：`lib/title-cards.ts` / `lib/color-grade.ts` / `lib/subtitle-fonts.ts`。

## 明确不做（勿重提）

模型级对口型（漫剧标准=模糊lip flap）；新video provider集成（Vidu Q2/Kling 3.0 Omni等——感知增益低于声音+节奏层）；LoRA角色锁定；AniSora自托管；深度图2.5D视差（批4 zoompan覆盖~60%，留触发条件）；BGM卡点/分段切歌（需beat detection栈）；超分补帧；多段逐段导演节拍（批2裁剪后暴露面收缩）；MovieAgent式解析层重构（解析层已是最专业一层）；词级卡拉OK字幕（沿用负结论）；九宫格一致性锚（非成片路径）。
