/**
 * Fal.ai 角色一致性测试
 * 测试 Instant Character / PuLID 等方案
 */

import { fal } from "@fal-ai/client";

// 配置 Fal.ai
fal.config({
  credentials: process.env.FAL_KEY,
});

// 方案1: Fal.ai Instant Character
async function testInstantCharacter(referenceImageUrl: string, prompts: string[]) {
  console.log("=== 测试 Fal.ai Instant Character ===");

  const results = [];
  for (const prompt of prompts) {
    const result = await fal.subscribe("fal-ai/instant-character", {
      input: {
        prompt: prompt,
        image_url: referenceImageUrl,
        num_images: 1,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log(`进度: ${update.logs?.[0]?.message || "处理中..."}`);
        }
      },
    });
    results.push({ prompt, output: result.data });
    console.log(`生成完成: ${prompt}`);
  }
  return results;
}

// 方案2: Fal.ai PuLID
async function testFalPuLID(referenceImageUrl: string, prompts: string[]) {
  console.log("=== 测试 Fal.ai PuLID ===");

  const results = [];
  for (const prompt of prompts) {
    const result = await fal.subscribe("fal-ai/pulid", {
      input: {
        prompt: prompt,
        reference_images: [referenceImageUrl],
        num_images: 1,
        guidance_scale: 4,
        id_weight: 1.0,
      },
      logs: true,
    });
    results.push({ prompt, output: result.data });
    console.log(`生成完成: ${prompt}`);
  }
  return results;
}

// 方案3: Fal.ai Flux with IP-Adapter
async function testFluxIPAdapter(referenceImageUrl: string, prompts: string[]) {
  console.log("=== 测试 Fal.ai Flux + IP-Adapter ===");

  const results = [];
  for (const prompt of prompts) {
    const result = await fal.subscribe("fal-ai/flux/dev/image-to-image", {
      input: {
        prompt: prompt,
        image_url: referenceImageUrl,
        strength: 0.75,
        num_images: 1,
      },
      logs: true,
    });
    results.push({ prompt, output: result.data });
    console.log(`生成完成: ${prompt}`);
  }
  return results;
}

// 主测试函数
async function runFalTest() {
  const referenceImage = process.env.TEST_IMAGE_URL || "https://example.com/reference.jpg";

  const testPrompts = [
    "anime style, young woman with long black hair, office setting, professional attire, warm lighting",
    "anime style, young woman with long black hair, coffee shop, casual outfit, cozy atmosphere",
    "anime style, young woman with long black hair, rooftop at sunset, evening dress, dramatic lighting",
  ];

  console.log("Fal.ai 角色一致性测试");
  console.log("参考图:", referenceImage);
  console.log("");

  try {
    const instantResults = await testInstantCharacter(referenceImage, testPrompts);
    console.log("\nInstant Character 完成，生成", instantResults.length, "张图片");

    const pulidResults = await testFalPuLID(referenceImage, testPrompts);
    console.log("\nPuLID 完成，生成", pulidResults.length, "张图片");

    return { instantCharacter: instantResults, pulid: pulidResults };
  } catch (error) {
    console.error("测试失败:", error);
    throw error;
  }
}

// Fal.ai 定价参考
function falPricing() {
  console.log("\n=== Fal.ai 定价参考 ===");
  console.log("Instant Character: ~$0.02/张");
  console.log("PuLID: ~$0.025/张");
  console.log("Flux Dev: ~$0.025/张");
  console.log("");
  console.log("特点:");
  console.log("- 按秒计费，更透明");
  console.log("- 支持队列订阅，适合批量任务");
  console.log("- 国内访问需要代理");
}

export {
  testInstantCharacter,
  testFalPuLID,
  testFluxIPAdapter,
  runFalTest,
  falPricing,
};
