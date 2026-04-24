# 视频生成技术调研报告

## 1. 主流视频生成方案对比

| 方案 | 质量 | 速度 | 价格 | API可用性 | 中文支持 |
|------|------|------|------|----------|----------|
| **Runway Gen-4** | ⭐⭐⭐⭐⭐ | 中 | $$$$ | ✅ 开放API | 一般 |
| **Runway Gen-3 Alpha** | ⭐⭐⭐⭐ | 快 | $$$ | ✅ 开放API | 一般 |
| **可灵 (Kling)** | ⭐⭐⭐⭐⭐ | 中 | $$ | ⚠️ 有限开放 | ✅ 原生 |
| **Luma Dream Machine** | ⭐⭐⭐⭐ | 快 | $$ | ✅ 开放API | 一般 |
| **Pika Labs** | ⭐⭐⭐ | 快 | $$ | ⚠️ 有限 | 一般 |
| **Stable Video Diffusion** | ⭐⭐⭐ | 慢 | $ | ✅ Replicate | 一般 |

## 2. 各方案详细分析

### 2.1 Runway Gen-3/Gen-4 (推荐 MVP)

**优点：**
- 视频质量行业领先
- API 文档完善，开发者友好
- 支持 Text-to-Video、Image-to-Video、Video-to-Video
- 提供 Turbo 版本，速度更快

**缺点：**
- 价格较高
- 需要申请 API 访问权限
- 中文提示词支持一般

**定价 (2025)：**
| 模型 | 价格 |
|------|------|
| Gen-4 / Gen-3 Alpha | 10-12 credits/秒 |
| Gen-4 Turbo | 5 credits/秒 |
| 4K 超分 | 2 credits/秒 |

*1 credit = $0.01*

**示例成本：**
- 5秒视频 (Gen-3 Alpha): 50 credits = $0.50
- 10秒视频 (Gen-3 Alpha): 100 credits = $1.00
- 5秒视频 (Gen-4 Turbo): 25 credits = $0.25

**API 示例：**
```typescript
const response = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RUNWAY_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gen3a_turbo",
    promptImage: "https://...",
    promptText: "camera slowly zooms in",
    duration: 5,
    ratio: "9:16"
  })
});
```

### 2.2 可灵 (Kling AI)

**优点：**
- 视频质量极高，尤其人物动作自然
- 中文原生支持
- 价格相对便宜
- 国内访问快

**缺点：**
- API 开放程度有限，需要申请
- 文档相对不完善
- 国际版和国内版有差异

**定价估算：**
- 标准模式: ~¥0.3/5秒
- 高清模式: ~¥0.5/5秒

**适用场景：** 对中文支持和人物动作要求高的场景

### 2.3 Luma Dream Machine

**优点：**
- API 开放，无需等待
- 生成速度快
- 价格适中
- 支持较长视频 (最长120秒)

**缺点：**
- 质量略逊于 Runway/可灵
- 人物一致性有时不稳定

**定价：**
- API 调用: ~$0.20/5秒

**API 示例：**
```typescript
const response = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${LUMA_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    prompt: "anime style character walking",
    keyframes: {
      frame0: { type: "image", url: "https://..." }
    },
    aspect_ratio: "9:16"
  })
});
```

### 2.4 Stable Video Diffusion (SVD) via Replicate

**优点：**
- 开源方案，无供应商锁定
- 通过 Replicate 即可使用
- 价格最便宜

**缺点：**
- 质量不如商业方案
- 生成速度慢
- 动作幅度小

**定价：**
- Replicate: ~$0.10/5秒

**适用场景：** 预算有限、对质量要求不高的场景

## 3. MVP 视频生成方案建议

### 推荐策略：多服务商 + 降级机制

```
┌─────────────────────────────────────────────────────┐
│                    视频生成请求                       │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              优先: Runway Gen-3 Alpha Turbo          │
│                   (质量好、速度快)                    │
└─────────────────────────┬───────────────────────────┘
                          │ 失败/超时
                          ▼
┌─────────────────────────────────────────────────────┐
│              备选: Luma Dream Machine                │
│                   (稳定、API开放)                    │
└─────────────────────────┬───────────────────────────┘
                          │ 失败/超时
                          ▼
┌─────────────────────────────────────────────────────┐
│              兜底: Replicate SVD                     │
│                   (便宜、可控)                        │
└─────────────────────────────────────────────────────┘
```

### MVP 阶段选型

| 优先级 | 方案 | 理由 |
|--------|------|------|
| **首选** | Runway Gen-3 Alpha Turbo | 质量/速度平衡，API成熟 |
| **备选** | Luma Dream Machine | API开放度高，无需等待审批 |
| **兜底** | Replicate SVD | 成本最低，确保服务可用 |

## 4. 成本估算

以生成一条3分钟漫剧 (20个分镜，每个3秒视频) 为例：

| 方案 | 单价 (5秒) | 20段成本 | 备注 |
|------|-----------|----------|------|
| Runway Gen-4 | $0.50 | $10.00 | 最高质量 |
| Runway Gen-3 Turbo | $0.25 | $5.00 | 推荐 |
| Luma | $0.20 | $4.00 | 备选 |
| 可灵 | ¥0.30 | ¥6.00 | 中文场景 |
| SVD (Replicate) | $0.10 | $2.00 | 兜底 |

## 5. 关键技术挑战

### 5.1 角色在视频中的一致性
- 图生视频时，角色特征可能变形
- **解决方案：** 控制运动幅度，使用较短视频段

### 5.2 生成时间长
- 单个5秒视频需要1-3分钟
- **解决方案：** 异步任务队列，并行生成多个分镜

### 5.3 成本控制
- 视频生成是最大成本项
- **解决方案：** 先出静态预览，用户确认后再生成视频

## 6. 参考资料

- [Runway API Pricing](https://docs.dev.runwayml.com/guides/pricing/)
- [Runway Developer Portal](https://dev.runwayml.com/)
- [Luma AI API Documentation](https://docs.lumalabs.ai/)
- [Replicate Video Models](https://replicate.com/collections/video-generation)
