/**
 * 角色一致性技术验证 POC
 * 测试 Replicate 上的 Flux Kontext Pro / PuLID 等方案
 */

import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// 方案1: Flux Kontext Pro - 角色一致性生成
async function testFluxKontextPro(referenceImageUrl: string, prompts: string[]) {
  console.log("=== 测试 Flux Kontext Pro ===");

  const results = [];
  for (const prompt of prompts) {
    const output = await replicate.run(
      "black-forest-labs/flux-kontext-pro",
      {
        input: {
          prompt: prompt,
          image_url: referenceImageUrl,
          aspect_ratio: "9:16",
          safety_tolerance: 2,
          output_format: "webp",
        }
      }
    );
    results.push({ prompt, output });
    console.log(`生成完成: ${prompt}`);
  }
  return results;
}

// 方案2: Flux PuLID - 人脸身份保持
async function testFluxPuLID(referenceImageUrl: string, prompts: string[]) {
  console.log("=== 测试 Flux PuLID ===");

  const results = [];
  for (const prompt of prompts) {
    const output = await replicate.run(
      "zsxkib/flux-pulid",
      {
        input: {
          prompt: prompt,
          main_face_image: referenceImageUrl,
          num_steps: 20,
          guidance_scale: 4,
          id_weight: 1.0,
          true_cfg: 1.0,
          width: 576,
          height: 1024,
        }
      }
    );
    results.push({ prompt, output });
    console.log(`生成完成: ${prompt}`);
  }
  return results;
}

// 方案3: InstantID - 单图身份迁移
async function testInstantID(referenceImageUrl: string, prompts: string[]) {
  console.log("=== 测试 InstantID ===");

  const results = [];
  for (const prompt of prompts) {
    const output = await replicate.run(
      "zsxkib/instant-id",
      {
        input: {
          image: referenceImageUrl,
          prompt: prompt,
          negative_prompt: "blurry, low quality, distorted face",
          ip_adapter_scale: 0.8,
          controlnet_conditioning_scale: 0.8,
          num_inference_steps: 30,
        }
      }
    );
    results.push({ prompt, output });
    console.log(`生成完成: ${prompt}`);
  }
  return results;
}

// 主测试函数
async function runCharacterConsistencyTest() {
  // 测试用参考图（需替换为实际图片URL）
  const referenceImage = "https://example.com/character-reference.jpg";

  // 测试场景：同一角色在不同场景
  const testPrompts = [
    "anime style, a young woman with long black hair, wearing white shirt, standing in modern office, professional lighting",
    "anime style, a young woman with long black hair, wearing casual clothes, sitting in coffee shop, warm lighting",
    "anime style, a young woman with long black hair, wearing evening dress, at a party, dramatic lighting",
  ];

  console.log("开始角色一致性测试...\n");
  console.log("参考图:", referenceImage);
  console.log("测试场景数:", testPrompts.length);
  console.log("\n");

  try {
    // 依次测试各方案
    const kontextResults = await testFluxKontextPro(referenceImage, testPrompts);
    const pulidResults = await testFluxPuLID(referenceImage, testPrompts);
    const instantIdResults = await testInstantID(referenceImage, testPrompts);

    // 输出结果汇总
    console.log("\n=== 测试结果汇总 ===");
    console.log("Flux Kontext Pro:", kontextResults.length, "张图片");
    console.log("Flux PuLID:", pulidResults.length, "张图片");
    console.log("InstantID:", instantIdResults.length, "张图片");

    return {
      kontextPro: kontextResults,
      puLID: pulidResults,
      instantID: instantIdResults,
    };
  } catch (error) {
    console.error("测试失败:", error);
    throw error;
  }
}

// 成本估算
function estimateCost() {
  console.log("\n=== 成本估算 (基于 Replicate 定价) ===");
  console.log("Flux Kontext Pro: ~$0.03/张");
  console.log("Flux PuLID: ~$0.02/张");
  console.log("InstantID: ~$0.02/张");
  console.log("\n生成20张分镜图的成本:");
  console.log("- Kontext Pro: $0.60");
  console.log("- PuLID: $0.40");
  console.log("- InstantID: $0.40");
}

export {
  testFluxKontextPro,
  testFluxPuLID,
  testInstantID,
  runCharacterConsistencyTest,
  estimateCost,
};
