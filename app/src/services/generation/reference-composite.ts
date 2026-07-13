/**
 * 多角色参考图合成
 *
 * 问题背景：OpenAI `/images/edits` 等「编辑型」端点收到多张参考图时，会把它们
 * 当成要融合重画的图层——多个角色的定妆脸会被搅在一起，输出谁都不像的四不像
 * （这正是「布布 + 一二同框，出图两个角色都不像」的根因）。
 *
 * 解决：把多张角色定妆图横向拼成【一张】合成参考图，每个角色下方标注名字，
 * 只给 edits 端点喂这一张底图。模型看到的是「一张包含所有角色的参考图」，
 * 能分清谁是谁，一致性显著提升。
 *
 * 复用原则：抓图统一走 lib/url-guard.safeDownload（SSRF 防护 + IP 钉定），
 * data:/相对路径/http 三态处理与 openai-compatible.fetchImageBlob 同源。
 */

import sharp from "sharp";
import { safeDownload } from "@/lib/url-guard";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:generation:reference-composite");

/** 单格目标高度（等高拼接，宽度按原图比例自适应） */
const CELL_HEIGHT = 768;
/** 单格最大宽度（超宽图裁到此宽，避免一张横图撑爆合成图） */
const CELL_MAX_WIDTH = 768;
/** 名字标签条高度 */
const LABEL_HEIGHT = 64;
/** 格与格之间的间距 */
const GUTTER = 24;
/** 合成图背景色（浅灰，和角色主体区分） */
const BG = { r: 245, g: 245, b: 245, alpha: 1 };

export interface ReferenceCell {
  /** 参考图 URL（http(s):// | data: | 相对 path 均可） */
  url: string;
  /** 角色名（标注在图下方，帮助模型区分谁是谁） */
  label?: string;
}

/**
 * 把 URL/data/相对路径统一拉成图片 Buffer。
 * 与 openai-compatible.fetchImageBlob 同源逻辑，避免 SSRF 绕过。
 */
async function loadImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)(;base64)?,(.+)$/);
    if (!match) throw new Error("无法解析 data URL 参考图");
    const [, , base64Marker, payload] = match;
    return base64Marker
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
  }

  // 相对 path（本地存储模式 DB 存的是 /uploads/...）补全成绝对 URL
  let absoluteUrl = url;
  if (!/^https?:\/\//i.test(absoluteUrl)) {
    const base =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://comic.cloudsentryai.com";
    const trimmedBase = base.replace(/\/+$/, "");
    const path = absoluteUrl.startsWith("/") ? absoluteUrl : `/${absoluteUrl}`;
    absoluteUrl = `${trimmedBase}${path}`;
  }

  const { buffer } = await safeDownload(absoluteUrl);
  return Buffer.from(buffer);
}

/** XML 转义，防止角色名里的 &/</> 破坏 SVG 标签 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 生成一条「名字标签」PNG（深底白字，居中） */
async function renderLabel(text: string, width: number): Promise<Buffer> {
  const safe = escapeXml(text).slice(0, 24);
  const fontSize = 32;
  const svg = `<svg width="${width}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#1f2937"/>
    <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
      font-family="sans-serif" font-size="${fontSize}" fill="#ffffff">${safe}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * 把一个角色的图 + 名字标签合成一格（图在上、标签在下）。
 * 返回该格的 PNG buffer 与实际宽度（等高 CELL_HEIGHT + LABEL_HEIGHT）。
 */
async function buildCell(
  cell: ReferenceCell
): Promise<{ buffer: Buffer; width: number }> {
  const raw = await loadImageBuffer(cell.url);

  // 等高缩放，限制最大宽；EXIF 方向归一，转 PNG 统一像素格式
  const resized = sharp(raw).rotate().resize({
    height: CELL_HEIGHT,
    width: CELL_MAX_WIDTH,
    fit: "inside",
    withoutEnlargement: false,
  });
  const resizedBuf = await resized.png().toBuffer();
  const meta = await sharp(resizedBuf).metadata();
  const imgWidth = meta.width ?? CELL_MAX_WIDTH;
  const imgHeight = meta.height ?? CELL_HEIGHT;

  const label = cell.label?.trim();
  const cellHeight = CELL_HEIGHT + (label ? LABEL_HEIGHT : 0);

  const layers: sharp.OverlayOptions[] = [
    // 图片垂直居中放在上部 CELL_HEIGHT 区域
    {
      input: resizedBuf,
      left: 0,
      top: Math.round((CELL_HEIGHT - imgHeight) / 2),
    },
  ];
  if (label) {
    const labelBuf = await renderLabel(label, imgWidth);
    layers.push({ input: labelBuf, left: 0, top: CELL_HEIGHT });
  }

  const buffer = await sharp({
    create: {
      width: imgWidth,
      height: cellHeight,
      channels: 4,
      background: BG,
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return { buffer, width: imgWidth };
}

/**
 * 把多张角色参考图横向拼成一张合成参考图（带名字标签）。
 *
 * @returns PNG 的 data URL（data:image/png;base64,...），可直接作为单张参考图
 *          喂给 provider；失败时抛错，由调用方决定降级。
 */
export async function composeReferenceGrid(
  cells: ReferenceCell[]
): Promise<string> {
  if (cells.length === 0) {
    throw new Error("composeReferenceGrid: 至少需要 1 张参考图");
  }

  const built = await Promise.all(cells.map((c) => buildCell(c)));

  const cellHeight =
    CELL_HEIGHT + (cells.some((c) => c.label?.trim()) ? LABEL_HEIGHT : 0);
  const totalWidth =
    built.reduce((sum, b) => sum + b.width, 0) + GUTTER * (built.length - 1);

  const layers: sharp.OverlayOptions[] = [];
  let x = 0;
  for (const b of built) {
    layers.push({ input: b.buffer, left: x, top: 0 });
    x += b.width + GUTTER;
  }

  const composed = await sharp({
    create: {
      width: totalWidth,
      height: cellHeight,
      channels: 4,
      background: BG,
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  const dataUrl = `data:image/png;base64,${composed.toString("base64")}`;
  log.info("参考图合成完成", {
    cellCount: cells.length,
    totalWidth,
    cellHeight,
    bytes: composed.length,
  });
  return dataUrl;
}
