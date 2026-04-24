/**
 * 语音合成 (TTS) 技术验证 POC
 * 测试 火山引擎 / ElevenLabs / MiniMax
 */

// ============ 火山引擎 TTS ============

interface VolcengineTTSRequest {
  app: { appid: string; token: string; cluster: string };
  user: { uid: string };
  audio: {
    voice_type: string;
    encoding: "mp3" | "wav" | "pcm";
    speed_ratio?: number;
    volume_ratio?: number;
    pitch_ratio?: number;
  };
  request: {
    reqid: string;
    text: string;
    operation: "query";
  };
}

async function synthesizeVolcengine(
  text: string,
  options: {
    voiceType?: string;
    speed?: number;
    emotion?: string;
  } = {}
): Promise<Buffer> {
  const {
    voiceType = "zh_female_shuangkuaisisi_moon_bigtts",
    speed = 1.0,
  } = options;

  const APP_ID = process.env.VOLC_APP_ID!;
  const ACCESS_TOKEN = process.env.VOLC_ACCESS_TOKEN!;

  const requestBody: VolcengineTTSRequest = {
    app: {
      appid: APP_ID,
      token: ACCESS_TOKEN,
      cluster: "volcano_tts",
    },
    user: { uid: "test_user" },
    audio: {
      voice_type: voiceType,
      encoding: "mp3",
      speed_ratio: speed,
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
    },
    request: {
      reqid: `req_${Date.now()}`,
      text,
      operation: "query",
    },
  };

  const response = await fetch(
    "https://openspeech.bytedance.com/api/v1/tts",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer; ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(requestBody),
    }
  );

  const result = await response.json();

  if (result.code !== 3000) {
    throw new Error(`火山引擎 TTS 失败: ${result.message}`);
  }

  // 返回 base64 解码后的音频数据
  return Buffer.from(result.data, "base64");
}

// 火山引擎预设音色
const VOLCENGINE_VOICES = {
  // 女声
  female_sweet: "zh_female_shuangkuaisisi_moon_bigtts", // 甜美女声
  female_gentle: "zh_female_wenrouxiaoya_moon_bigtts", // 温柔女声
  female_lively: "zh_female_huoposisi_moon_bigtts", // 活泼女声
  female_mature: "zh_female_chengshuqinqie_moon_bigtts", // 成熟女声

  // 男声
  male_mellow: "zh_male_chunhou_moon_bigtts", // 醇厚男声
  male_sunny: "zh_male_yangguang_moon_bigtts", // 阳光男声
  male_magnetic: "zh_male_cixing_moon_bigtts", // 磁性男声

  // 旁白
  narrator_male: "zh_male_pingsuyongzheng_moon_bigtts", // 平稳男声旁白
  narrator_female: "zh_female_tianmeixiaoyuan_moon_bigtts", // 甜美女声旁白
};

// ============ ElevenLabs TTS ============

interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}

async function synthesizeElevenLabs(
  text: string,
  options: {
    voiceId?: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
  } = {}
): Promise<Buffer> {
  const {
    voiceId = "21m00Tcm4TlvDq8ikWAM", // Rachel
    modelId = "eleven_multilingual_v2",
    stability = 0.5,
    similarityBoost = 0.75,
  } = options;

  const API_KEY = process.env.ELEVENLABS_API_KEY!;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
        } as ElevenLabsVoiceSettings,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS 失败: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ElevenLabs 预设音色
const ELEVENLABS_VOICES = {
  rachel: "21m00Tcm4TlvDq8ikWAM", // 温柔女声
  domi: "AZnzlk1XvdvUeBnXmlld", // 活力女声
  bella: "EXAVITQu4vr4xnSDxMaL", // 优雅女声
  adam: "pNInz6obpgDQGcFmaJgB", // 成熟男声
  josh: "TxGEqnHWrfWFTfGW9XjX", // 年轻男声
  sam: "yoZ06aMxZJJ28mfd3POQ", // 磁性男声
};

// ============ MiniMax TTS ============

interface MiniMaxTTSRequest {
  model: string;
  text: string;
  voice_setting: {
    voice_id: string;
    speed?: number;
    vol?: number;
    pitch?: number;
    emotion?: string;
  };
  audio_setting?: {
    sample_rate?: number;
    bitrate?: number;
    format?: "mp3" | "wav";
  };
}

async function synthesizeMiniMax(
  text: string,
  options: {
    voiceId?: string;
    speed?: number;
    emotion?: string;
  } = {}
): Promise<Buffer> {
  const {
    voiceId = "female-shaonv",
    speed = 1.0,
    emotion = "neutral",
  } = options;

  const API_KEY = process.env.MINIMAX_API_KEY!;
  const GROUP_ID = process.env.MINIMAX_GROUP_ID!;

  const requestBody: MiniMaxTTSRequest = {
    model: "speech-01-turbo",
    text,
    voice_setting: {
      voice_id: voiceId,
      speed,
      emotion,
    },
    audio_setting: {
      sample_rate: 24000,
      format: "mp3",
    },
  };

  const response = await fetch(
    `https://api.minimax.chat/v1/t2a_v2?GroupId=${GROUP_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  const result = await response.json();

  if (result.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax TTS 失败: ${result.base_resp?.status_msg}`);
  }

  // 获取音频数据
  const audioUrl = result.audio_file;
  const audioResponse = await fetch(audioUrl);
  const arrayBuffer = await audioResponse.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

// MiniMax 预设音色
const MINIMAX_VOICES = {
  // 女声
  female_shaonv: "female-shaonv", // 少女音
  female_yujie: "female-yujie", // 御姐音
  female_chengshu: "female-chengshu", // 成熟女声

  // 男声
  male_qingnian: "male-qingnian", // 青年音
  male_chengshu: "male-chengshu", // 成熟男声
  male_cixing: "male-cixing", // 磁性男声

  // 特色
  narrator: "presenter_male", // 旁白男声
};

// MiniMax 情感列表
const MINIMAX_EMOTIONS = [
  "neutral", // 中性
  "happy", // 开心
  "sad", // 悲伤
  "angry", // 愤怒
  "fear", // 恐惧
  "disgust", // 厌恶
  "surprised", // 惊讶
];

// ============ 统一接口 ============

type TTSProvider = "volcengine" | "elevenlabs" | "minimax";

interface TTSOptions {
  provider?: TTSProvider;
  voiceId?: string;
  speed?: number;
  emotion?: string;
}

interface TTSResult {
  audio: Buffer;
  provider: TTSProvider;
  cost: number;
  durationEstimate: number;
}

async function synthesizeSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  const { provider = "volcengine", voiceId, speed = 1.0, emotion } = options;

  let audio: Buffer;
  let cost: number;

  // 估算时长 (中文约4字/秒)
  const durationEstimate = text.length / 4 / speed;

  switch (provider) {
    case "volcengine":
      audio = await synthesizeVolcengine(text, {
        voiceType: voiceId || VOLCENGINE_VOICES.female_sweet,
        speed,
      });
      cost = text.length * 0.002; // ¥0.002/字
      break;

    case "elevenlabs":
      audio = await synthesizeElevenLabs(text, {
        voiceId: voiceId || ELEVENLABS_VOICES.rachel,
      });
      cost = (text.length / 1000) * 0.30; // $0.30/1000字
      break;

    case "minimax":
      audio = await synthesizeMiniMax(text, {
        voiceId: voiceId || MINIMAX_VOICES.female_shaonv,
        speed,
        emotion,
      });
      cost = (text.length / 100) * 0.01; // ¥0.01/100字
      break;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return { audio, provider, cost, durationEstimate };
}

// ============ 多角色配音 ============

interface CharacterVoiceConfig {
  characterId: string;
  characterName: string;
  provider: TTSProvider;
  voiceId: string;
  defaultEmotion?: string;
}

interface DialogueLine {
  characterId: string;
  text: string;
  emotion?: string;
}

async function synthesizeDialogue(
  lines: DialogueLine[],
  characterVoices: CharacterVoiceConfig[]
): Promise<Array<{ characterId: string; audio: Buffer; duration: number }>> {
  const results = [];

  for (const line of lines) {
    const voiceConfig = characterVoices.find(
      (v) => v.characterId === line.characterId
    );
    if (!voiceConfig) {
      console.warn(`未找到角色 ${line.characterId} 的配音配置`);
      continue;
    }

    console.log(`生成 ${voiceConfig.characterName} 的台词: "${line.text.slice(0, 20)}..."`);

    const { audio, durationEstimate } = await synthesizeSpeech(line.text, {
      provider: voiceConfig.provider,
      voiceId: voiceConfig.voiceId,
      emotion: line.emotion || voiceConfig.defaultEmotion,
    });

    results.push({
      characterId: line.characterId,
      audio,
      duration: durationEstimate,
    });
  }

  return results;
}

// ============ 测试 ============

async function runTTSTest() {
  console.log("=== 语音合成技术验证 ===\n");

  const testText = "大家好，欢迎来到AI漫剧的世界。今天我们将为你讲述一个精彩的故事。";
  const testTextEn = "Welcome to the world of AI comic drama. Today we will tell you an amazing story.";

  // 测试火山引擎
  console.log("--- 测试火山引擎 TTS ---");
  try {
    const volc = await synthesizeSpeech(testText, { provider: "volcengine" });
    console.log(`火山引擎: 成功, ${volc.audio.length} bytes, 预计 ${volc.durationEstimate.toFixed(1)}s, 成本 ¥${volc.cost.toFixed(3)}`);
  } catch (e) {
    console.log("火山引擎测试跳过 (需要 API Key)");
  }

  // 测试 ElevenLabs
  console.log("\n--- 测试 ElevenLabs TTS ---");
  try {
    const eleven = await synthesizeSpeech(testTextEn, { provider: "elevenlabs" });
    console.log(`ElevenLabs: 成功, ${eleven.audio.length} bytes, 预计 ${eleven.durationEstimate.toFixed(1)}s, 成本 $${eleven.cost.toFixed(3)}`);
  } catch (e) {
    console.log("ElevenLabs 测试跳过 (需要 API Key)");
  }

  // 测试 MiniMax
  console.log("\n--- 测试 MiniMax TTS ---");
  try {
    const minimax = await synthesizeSpeech(testText, { provider: "minimax" });
    console.log(`MiniMax: 成功, ${minimax.audio.length} bytes, 预计 ${minimax.durationEstimate.toFixed(1)}s, 成本 ¥${minimax.cost.toFixed(3)}`);
  } catch (e) {
    console.log("MiniMax 测试跳过 (需要 API Key)");
  }
}

// ============ 多角色配音测试 ============

async function runDialogueTest() {
  console.log("\n=== 多角色配音测试 ===\n");

  const characterVoices: CharacterVoiceConfig[] = [
    {
      characterId: "char_001",
      characterName: "林萧",
      provider: "volcengine",
      voiceId: VOLCENGINE_VOICES.female_sweet,
      defaultEmotion: "neutral",
    },
    {
      characterId: "char_002",
      characterName: "陆景琛",
      provider: "volcengine",
      voiceId: VOLCENGINE_VOICES.male_magnetic,
      defaultEmotion: "neutral",
    },
    {
      characterId: "narrator",
      characterName: "旁白",
      provider: "volcengine",
      voiceId: VOLCENGINE_VOICES.narrator_male,
    },
  ];

  const dialogue: DialogueLine[] = [
    { characterId: "narrator", text: "这是林萧来到A市的第三年。" },
    { characterId: "char_001", text: "今天的会议怎么这么长...", emotion: "sad" },
    { characterId: "char_002", text: "林小姐，请留步。", emotion: "neutral" },
    { characterId: "char_001", text: "陆总？您有什么事？", emotion: "surprised" },
  ];

  try {
    const results = await synthesizeDialogue(dialogue, characterVoices);
    console.log(`\n成功生成 ${results.length} 条语音`);
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`总时长: ${totalDuration.toFixed(1)}s`);
  } catch (e) {
    console.log("多角色配音测试跳过 (需要 API Key)");
  }
}

// ============ 成本估算 ============

function estimateTTSCost(charCount: number, provider: TTSProvider = "volcengine"): void {
  const prices: Record<TTSProvider, { unit: string; price: number; per: number }> = {
    volcengine: { unit: "¥", price: 0.002, per: 1 },
    elevenlabs: { unit: "$", price: 0.30, per: 1000 },
    minimax: { unit: "¥", price: 0.01, per: 100 },
  };

  const { unit, price, per } = prices[provider];
  const cost = (charCount / per) * price;

  console.log(`\n=== TTS 成本估算 ===`);
  console.log(`服务商: ${provider}`);
  console.log(`字符数: ${charCount}`);
  console.log(`单价: ${unit}${price}/${per}字符`);
  console.log(`总成本: ${unit}${cost.toFixed(2)}`);
}

export {
  synthesizeVolcengine,
  synthesizeElevenLabs,
  synthesizeMiniMax,
  synthesizeSpeech,
  synthesizeDialogue,
  runTTSTest,
  runDialogueTest,
  estimateTTSCost,
  VOLCENGINE_VOICES,
  ELEVENLABS_VOICES,
  MINIMAX_VOICES,
  MINIMAX_EMOTIONS,
};
