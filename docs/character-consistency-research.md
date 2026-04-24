# 角色一致性技术验证报告

## 1. 技术方案对比

基于调研，当前主流的角色一致性方案有以下几种：

| 方案 | 身份保持度 | 提示词遵循 | 速度 | 资源占用 | API可用性 |
|------|-----------|-----------|------|---------|----------|
| **Flux Kontext Pro** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 快 | 低 | ✅ Replicate |
| **PuLID** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 慢 | 高 | ✅ Replicate/Fal.ai |
| **InstantID** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 中 | ✅ Replicate/Fal.ai |
| **IP-Adapter FaceID** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 快 | 低 | ✅ 多平台 |
| **Ideogram Character** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 快 | 低 | ✅ Replicate |

## 2. 各方案详细分析

### 2.1 Flux Kontext Pro (推荐 MVP 首选)

**优点：**
- 2025年最新方案，专为角色一致性设计
- 单张参考图即可保持身份
- 速度快，适合生产环境
- Black Forest Labs 官方支持

**缺点：**
- 价格相对较高 (~$0.03/张)
- 对非人脸场景支持一般

**适用场景：** 需要快速、稳定的角色一致性生成

### 2.2 PuLID (Pure and Lightning ID)

**优点：**
- 身份保持度最高 (研究表明优于 InstantID)
- 能准确复制光照、风格
- 对真实人像效果极佳

**缺点：**
- 资源消耗最大
- 小脸场景容易失真
- 不同图片间一致性仍有挑战

**适用场景：** 对身份保持要求极高的场景

### 2.3 InstantID

**优点：**
- 单图即可工作，无需训练
- 侧脸/角度变化表现好
- 平衡了质量和提示词遵循

**缺点：**
- 正脸相似度不如 PuLID
- 82-86% 的面部识别相似度

**适用场景：** 需要多角度变化的场景

### 2.4 IP-Adapter FaceID

**优点：**
- 速度最快，VRAM 占用最低
- 兼容性最好，支持各种模型
- 提示词遵循度最高

**缺点：**
- 身份准确度相对较低

**适用场景：** 对速度要求高、身份要求相对宽松的场景

## 3. MVP 技术选型建议

### 推荐方案：分层策略

```
┌─────────────────────────────────────────────────────┐
│                    用户上传参考图                     │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              第一层：快速预览 (低成本)                │
│         使用 IP-Adapter FaceID / InstantID          │
│              成本: ~$0.01/张                         │
└─────────────────────────┬───────────────────────────┘
                          │ 用户确认满意
                          ▼
┌─────────────────────────────────────────────────────┐
│              第二层：高质量生成                       │
│         使用 Flux Kontext Pro / PuLID               │
│              成本: ~$0.03/张                         │
└─────────────────────────────────────────────────────┘
```

### MVP 阶段具体建议

| 阶段 | 方案 | 理由 |
|------|------|------|
| **MVP v1** | Flux Kontext Pro | 效果稳定、API成熟、速度快 |
| **MVP v2** | + PuLID 作为备选 | 提供"高保真"选项 |
| **后期** | + LoRA 训练 | 为高频角色提供专属模型 |

## 4. API 调用示例

### Replicate - Flux Kontext Pro

```typescript
const output = await replicate.run(
  "black-forest-labs/flux-kontext-pro",
  {
    input: {
      prompt: "anime style, young woman, office scene",
      image_url: "https://...", // 参考图
      aspect_ratio: "9:16",
    }
  }
);
```

### Fal.ai - Instant Character

```typescript
const result = await fal.subscribe("fal-ai/instant-character", {
  input: {
    prompt: "anime style, young woman, coffee shop",
    image_url: "https://...",
  }
});
```

## 5. 成本估算

以生成一条漫剧 (20个分镜) 为例：

| 方案 | 单价 | 20张成本 | 备注 |
|------|------|----------|------|
| Flux Kontext Pro | $0.03 | $0.60 | 推荐 |
| PuLID | $0.02 | $0.40 | 速度慢 |
| InstantID | $0.02 | $0.40 | 平衡 |
| IP-Adapter | $0.01 | $0.20 | 预览用 |

**建议定价策略：**
- 预览模式：使用低成本方案，免费或低积分
- 正式生成：使用高质量方案，正常计费

## 6. 风险与应对

| 风险 | 概率 | 应对措施 |
|------|------|----------|
| 角色崩坏 | 中 | 生成后做人脸相似度校验，不达标自动重试 |
| API 不稳定 | 低 | 多服务商备份 (Replicate + Fal.ai) |
| 成本超预期 | 中 | 分层生成策略，预览用低成本方案 |
| 风格不一致 | 中 | 固定 seed + 统一风格提示词模板 |

## 7. 下一步行动

1. **申请 API Key**
   - Replicate: https://replicate.com
   - Fal.ai: https://fal.ai

2. **运行 POC 测试**
   ```bash
   cd poc
   npm install replicate
   npx ts-node character-consistency-test.ts
   ```

3. **评估指标**
   - 人脸相似度 (使用 InsightFace 计算)
   - 生成速度
   - 主观质量评分

4. **确定最终方案**

---

## 参考资料

- [Replicate - Generate Consistent Characters](https://replicate.com/blog/generate-consistent-characters)
- [PuLID vs InstantID vs FaceID 对比](https://myaiforce.com/pulid-vs-instantid-vs-faceid/)
- [Flux PuLID 对比分析](https://myaiforce.com/flux-pulid-vs-ecomid-vs-instantid/)
- [PuLID 论文](https://arxiv.org/html/2404.16022v2)
- [Fal.ai Instant Character](https://fal.ai/models/fal-ai/instant-character/api)
