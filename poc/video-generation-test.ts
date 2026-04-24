/**
 * 视频生成技术验证 POC
 * 测试 Runway / Luma / Replicate SVD
 */

// ============ Runway Gen-3 Alpha ============

interface RunwayVideoRequest {
  model: "gen3a_turbo" | "gen3a";
  promptImage: string;
  promptText?: string;
  duration: 5 | 10;
  ratio: "16:9" | "9:16" | "1:1";
}

interface RunwayTaskResponse {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  output?: string[];
}

async function generateVideoRunway(
  imageUrl: string,
  prompt: string,
  options: { duration?: 5 | 10; ratio?: "16:9" | "9:16" } = {}
): Promise<string> {
  const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
  const { duration = 5, ratio = "9:16" } = options;

  // 1. 创建生成任务
  const createResponse = await fetch(
    "https://api.dev.runwayml.com/v1/image_to_video",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNWAY_API_KEY}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        model: "gen3a_turbo",
        promptImage: imageUrl,
        promptText: prompt,
        duration,
        ratio,
      } as RunwayVideoRequest),
    }
  );

  const { id: taskId } = await createResponse.json();
  console.log(`Runway 任务已创建: ${taskId}`);

  // 2. 轮询等待完成
  let result: RunwayTaskResponse;
  while (true) {
    const statusResponse = await fetch(
      `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
      {
        headers: { Authorization: `Bearer ${RUNWAY_API_KEY}` },
      }
    );
    result = await statusResponse.json();

    if (result.status === "SUCCEEDED") {
      console.log("Runway 生成完成!");
      return result.output![0];
    }
    if (result.status === "FAILED") {
      throw new Error("Runway 生成失败");
    }

    console.log(`状态: ${result.status}, 等待中...`);
    await sleep(5000);
  }
}

// ============ Luma Dream Machine ============

interface LumaGenerationRequest {
  prompt: string;
  keyframes?: {
    frame0?: { type: "image"; url: string };
    frame1?: { type: "image"; url: string };
  };
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  loop?: boolean;
}

async function generateVideoLuma(
  imageUrl: string,
  prompt: string,
  options: { aspectRatio?: "16:9" | "9:16" } = {}
): Promise<string> {
  const LUMA_API_KEY = process.env.LUMA_API_KEY;
  const { aspectRatio = "9:16" } = options;

  // 1. 创建生成任务
  const createResponse = await fetch(
    "https://api.lumalabs.ai/dream-machine/v1/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LUMA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        keyframes: {
          frame0: { type: "image", url: imageUrl },
        },
        aspect_ratio: aspectRatio,
      } as LumaGenerationRequest),
    }
  );

  const { id: generationId } = await createResponse.json();
  console.log(`Luma 任务已创建: ${generationId}`);

  // 2. 轮询等待完成
  while (true) {
    const statusResponse = await fetch(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`,
      {
        headers: { Authorization: `Bearer ${LUMA_API_KEY}` },
      }
    );
    const result = await statusResponse.json();

    if (result.state === "completed") {
      console.log("Luma 生成完成!");
      return result.assets.video;
    }
    if (result.state === "failed") {
      throw new Error(`Luma 生成失败: ${result.failure_reason}`);
    }

    console.log(`状态: ${result.state}, 等待中...`);
    await sleep(5000);
  }
}

// ============ Replicate SVD ============

import Replicate from "replicate";

async function generateVideoSVD(
  imageUrl: string,
  options: {
    motionBucketId?: number;
    fps?: number;
    numFrames?: number;
  } = {}
): Promise<string> {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  const { motionBucketId = 127, fps = 7, numFrames = 25 } = options;

  console.log("开始 SVD 生成...");

  const output = await replicate.run(
    "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
    {
      input: {
        input_image: imageUrl,
        motion_bucket_id: motionBucketId,
        fps,
        num_frames: numFrames,
      },
    }
  );

  console.log("SVD 生成完成!");
  return output as string;
}

// ============ 统一接口 ============

type VideoProvider = "runway" | "luma" | "svd";

interface VideoGenerationOptions {
  provider?: VideoProvider;
  prompt?: string;
  duration?: 5 | 10;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}

async function generateVideo(
  imageUrl: string,
  options: VideoGenerationOptions = {}
): Promise<{ videoUrl: string; provider: VideoProvider; cost: number }> {
  const { provider = "runway", prompt = "gentle camera movement", duration = 5, aspectRatio = "9:16" } = options;

  let videoUrl: string;
  let cost: number;

  switch (provider) {
    case "runway":
      videoUrl = await generateVideoRunway(imageUrl, prompt, { duration, ratio: aspectRatio as "16:9" | "9:16" });
      cost = duration === 5 ? 0.25 : 0.50; // Gen-3 Turbo pricing
      break;

    case "luma":
      videoUrl = await generateVideoLuma(imageUrl, prompt, { aspectRatio: aspectRatio as "16:9" | "9:16" });
      cost = 0.20;
      break;

    case "svd":
      videoUrl = await generateVideoSVD(imageUrl);
      cost = 0.10;
      break;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return { videoUrl, provider, cost };
}

// ============ 批量生成 ============

interface SceneVideo {
  sceneId: number;
  imageUrl: string;
  prompt: string;
}

async function generateVideosForScenes(
  scenes: SceneVideo[],
  provider: VideoProvider = "runway"
): Promise<Array<{ sceneId: number; videoUrl: string; cost: number }>> {
  const results = [];

  for (const scene of scenes) {
    console.log(`\n生成场景 ${scene.sceneId} 的视频...`);
    try {
      const { videoUrl, cost } = await generateVideo(scene.imageUrl, {
        provider,
        prompt: scene.prompt,
      });
      results.push({ sceneId: scene.sceneId, videoUrl, cost });
    } catch (error) {
      console.error(`场景 ${scene.sceneId} 生成失败:`, error);
      // 降级到备选方案
      if (provider === "runway") {
        console.log("尝试 Luma 备选方案...");
        const { videoUrl, cost } = await generateVideo(scene.imageUrl, {
          provider: "luma",
          prompt: scene.prompt,
        });
        results.push({ sceneId: scene.sceneId, videoUrl, cost });
      }
    }
  }

  return results;
}

// ============ 工具函数 ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ 测试 ============

async function runVideoTest() {
  const testImage = process.env.TEST_IMAGE_URL || "https://example.com/test.jpg";

  console.log("=== 视频生成技术验证 ===\n");
  console.log("测试图片:", testImage);

  const testScenes: SceneVideo[] = [
    { sceneId: 1, imageUrl: testImage, prompt: "gentle zoom in, cinematic" },
    { sceneId: 2, imageUrl: testImage, prompt: "slow pan right, dramatic lighting" },
    { sceneId: 3, imageUrl: testImage, prompt: "subtle movement, anime style" },
  ];

  // 测试各方案
  console.log("\n--- 测试 Runway ---");
  try {
    const runway = await generateVideo(testImage, { provider: "runway" });
    console.log("Runway 结果:", runway);
  } catch (e) {
    console.log("Runway 测试跳过 (需要 API Key)");
  }

  console.log("\n--- 测试 Luma ---");
  try {
    const luma = await generateVideo(testImage, { provider: "luma" });
    console.log("Luma 结果:", luma);
  } catch (e) {
    console.log("Luma 测试跳过 (需要 API Key)");
  }

  console.log("\n--- 测试 SVD (Replicate) ---");
  try {
    const svd = await generateVideo(testImage, { provider: "svd" });
    console.log("SVD 结果:", svd);
  } catch (e) {
    console.log("SVD 测试跳过 (需要 API Key)");
  }
}

// ============ 成本估算 ============

function estimateVideoCost(sceneCount: number, provider: VideoProvider = "runway"): void {
  const prices: Record<VideoProvider, number> = {
    runway: 0.25, // Gen-3 Turbo 5s
    luma: 0.20,
    svd: 0.10,
  };

  const costPerScene = prices[provider];
  const totalCost = sceneCount * costPerScene;

  console.log(`\n=== 视频生成成本估算 ===`);
  console.log(`服务商: ${provider}`);
  console.log(`场景数: ${sceneCount}`);
  console.log(`单价: $${costPerScene}/场景`);
  console.log(`总成本: $${totalCost.toFixed(2)}`);
}

export {
  generateVideoRunway,
  generateVideoLuma,
  generateVideoSVD,
  generateVideo,
  generateVideosForScenes,
  runVideoTest,
  estimateVideoCost,
};
