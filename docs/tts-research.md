# 语音合成 (TTS) 技术调研报告

## 1. 主流 TTS 方案对比

| 方案 | 中文质量 | 情感表达 | 声音克隆 | 价格 | API易用性 |
|------|---------|---------|---------|------|----------|
| **火山引擎 TTS** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | $ | ✅ |
| **ElevenLabs** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | $$$ | ✅ |
| **MiniMax TTS** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | $$ | ✅ |
| **Azure TTS** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ | $$ | ✅ |
| **OpenAI TTS** | ⭐⭐⭐ | ⭐⭐⭐ | ❌ | $$ | ✅ |
| **Fish Audio** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | $ | ✅ |

## 2. 各方案详细分析

### 2.1 火山引擎 TTS (推荐 - 中文场景首选)

**优点：**
- 中文语音质量极高，自然度接近真人
- 价格便宜，国内厂商
- 丰富的预设音色 (100+)
- 支持 SSML 情感标签
- 国内访问快，无需翻墙

**缺点：**
- 英文质量一般
- 声音克隆需要企业认证

**定价：**
| 类型 | 价格 |
|------|------|
| 标准音色 | ¥0.002/字符 |
| 精品音色 | ¥0.004/字符 |
| 声音克隆 | ¥0.01/字符 |

**示例成本：** 1000字旁白 = ¥2-4

**API 示例：**
```typescript
import { SpeechClient } from "@volcengine/openapi";

const client = new SpeechClient({
  accessKeyId: process.env.VOLC_ACCESS_KEY,
  accessKeySecret: process.env.VOLC_SECRET_KEY,
});

const result = await client.tts({
  text: "大家好，欢迎收看今天的故事",
  voice_type: "zh_female_shuangkuaisisi_moon_bigtts", // 音色
  encoding: "mp3",
  speed_ratio: 1.0,
  emotion: "happy", // 情感
});
```

### 2.2 ElevenLabs (推荐 - 情感表达最佳)

**优点：**
- 情感表达行业领先
- 声音克隆效果极佳 (仅需几秒样本)
- 多语言支持好
- API 设计优雅

**缺点：**
- 价格较高
- 中文质量不如国内方案
- 需要科学上网

**定价：**
| 套餐 | 价格 | 字符数 |
|------|------|--------|
| Free | $0 | 10,000/月 |
| Starter | $5/月 | 30,000/月 |
| Creator | $22/月 | 100,000/月 |
| API 按量 | ~$0.30/1000字符 | - |

**API 示例：**
```typescript
import { ElevenLabsClient } from "elevenlabs";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const audio = await client.generate({
  voice: "Rachel",
  text: "Welcome to our story",
  model_id: "eleven_multilingual_v2",
});
```

### 2.3 MiniMax TTS (推荐 - 性价比之选)

**优点：**
- 中文质量极高
- 情感表达丰富
- 支持多角色对话生成
- 价格适中
- 提供"语音克隆"功能

**缺点：**
- 国际知名度不如 ElevenLabs
- 文档相对简单

**定价：**
- 标准: ~¥0.01/100字符
- 高级音色: ~¥0.02/100字符

**API 示例：**
```typescript
const response = await fetch("https://api.minimax.chat/v1/t2a_v2", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${MINIMAX_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "speech-01-turbo",
    text: "这是一个测试文本",
    voice_setting: {
      voice_id: "female-shaonv",
      speed: 1.0,
      emotion: "happy",
    },
  }),
});
```

### 2.4 Fish Audio (开源友好)

**优点：**
- 开源模型可本地部署
- 声音克隆效果好
- 社区活跃
- 价格便宜

**缺点：**
- 商业支持有限
- 本地部署需要 GPU

**定价：**
- API: ~$0.01/1000字符
- 自部署: 免费

### 2.5 Azure TTS / OpenAI TTS

**Azure TTS:**
- 企业级稳定性
- 中文质量不错
- 价格: ~$16/100万字符

**OpenAI TTS:**
- 简单易用
- 仅6种预设音色
- 不支持中文音色
- 价格: $15/100万字符

## 3. 漫剧场景特殊需求

### 3.1 多角色配音
漫剧需要为不同角色分配不同声线：

```typescript
interface CharacterVoice {
  characterId: string;
  characterName: string;
  voiceProvider: "volcengine" | "elevenlabs" | "minimax";
  voiceId: string;
  defaultEmotion: string;
}

const characterVoices: CharacterVoice[] = [
  {
    characterId: "char_001",
    characterName: "林萧",
    voiceProvider: "volcengine",
    voiceId: "zh_female_shuangkuaisisi_moon_bigtts",
    defaultEmotion: "neutral",
  },
  {
    characterId: "char_002",
    characterName: "陆景琛",
    voiceProvider: "volcengine",
    voiceId: "zh_male_chunhou_moon_bigtts",
    defaultEmotion: "cold",
  },
];
```

### 3.2 旁白 vs 对话
- **旁白**: 需要稳定、沉稳的声线
- **对话**: 需要情感丰富、符合角色性格

### 3.3 情感控制
根据分镜脚本中的 emotion 字段调整语音情感：

```typescript
const emotionMapping = {
  "happy": { speed: 1.1, pitch: 1.05, emotion: "happy" },
  "sad": { speed: 0.9, pitch: 0.95, emotion: "sad" },
  "angry": { speed: 1.2, pitch: 1.1, emotion: "angry" },
  "calm": { speed: 1.0, pitch: 1.0, emotion: "neutral" },
};
```

## 4. MVP 语音方案建议

### 推荐策略：国内外双方案

```
┌─────────────────────────────────────────────────────┐
│                    语音合成请求                       │
└─────────────────────────┬───────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│   中文内容            │   │   英文/多语言内容    │
│   火山引擎 TTS        │   │   ElevenLabs        │
│   (质量高、便宜)      │   │   (情感好、多语言)   │
└─────────────────────┘   └─────────────────────┘
```

### MVP 阶段选型

| 场景 | 首选方案 | 备选方案 |
|------|---------|---------|
| **中文配音** | 火山引擎 | MiniMax |
| **旁白** | 火山引擎 | Azure |
| **英文/多语言** | ElevenLabs | OpenAI |
| **声音克隆** | ElevenLabs | Fish Audio |

## 5. 成本估算

以一条3分钟漫剧为例 (约500字对话 + 200字旁白)：

| 方案 | 单价 | 700字成本 | 备注 |
|------|------|----------|------|
| 火山引擎 | ¥0.002/字 | ¥1.4 | **推荐** |
| MiniMax | ¥0.01/100字 | ¥0.7 | 性价比高 |
| ElevenLabs | $0.30/1000字 | $0.21 | 情感好 |
| Azure | $0.016/1000字 | $0.01 | 企业级 |

**结论：语音合成成本远低于图像和视频生成**

## 6. 技术实现要点

### 6.1 异步生成 + 缓存
```typescript
// 相同文本+音色可缓存
const cacheKey = `tts:${hash(text)}:${voiceId}`;
const cached = await redis.get(cacheKey);
if (cached) return cached;
```

### 6.2 音频格式标准化
- 统一输出 MP3 格式
- 采样率: 24000Hz
- 比特率: 128kbps

### 6.3 时长预估
用于音画同步：
```typescript
// 中文约 4 字/秒
const estimatedDuration = text.length / 4;
```

## 7. 参考资料

- [火山引擎 TTS 文档](https://www.volcengine.com/docs/6561)
- [ElevenLabs API 文档](https://docs.elevenlabs.io/)
- [MiniMax TTS 文档](https://api.minimax.chat/document/guides/T2A-v2)
- [Fish Audio](https://fish.audio/)
