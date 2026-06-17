"use client";

/**
 * 分镜滤镜的浏览器端精确预览。
 *
 * 把 video-synthesis.ts 的 FX_FILTERS（FFmpeg 滤镜）逐个翻译为 SVG filter，
 * 让预览所见 = 导出所得。映射依据：
 * - FFmpeg colorchannelmixer（RGB 线性变换）↔ SVG feColorMatrix type=matrix（逐系数通用）
 * - FFmpeg eq=saturation ↔ feColorMatrix type=saturate
 * - FFmpeg hue=s=0（去色）↔ feColorMatrix saturate 0
 * - FFmpeg eq=contrast / colorbalance ↔ feComponentTransfer 线性变换
 * - FFmpeg gblur=sigma ↔ feGaussianBlur stdDeviation
 * - FFmpeg vignette ↔ radialGradient 遮罩叠加
 *
 * 用法：在预览容器内渲染一次 <SceneFilterDefs />（注入所有 <filter> 定义），
 * 媒体元素通过 style={{ filter: sceneFilterCss(effectId) }} 引用。
 */

import type { SceneEffectId } from "@/types/export-style";

/** 每个滤镜对应的 SVG <filter> id（与 FFmpeg FX_FILTERS 一一对应） */
const FILTER_ID_PREFIX = "fx-";

/** 返回媒体元素应用的 CSS filter 值（引用 SVG filter；blur 类叠加原生 blur） */
export function sceneFilterCss(
  effect?: SceneEffectId | null
): string | undefined {
  if (!effect) return undefined;
  // blur 用原生 CSS（性能更好，等价 gblur）；其余引用 SVG filter
  if (effect === "blur") return "blur(8px)";
  if (effect === "sharpen") return `url(#${FILTER_ID_PREFIX}sharpen)`;
  return `url(#${FILTER_ID_PREFIX}${effect})`;
}

/**
 * 注入所有滤镜的 SVG <filter> 定义（隐藏的 svg，仅供引用）。
 * 在预览播放器内渲染一次即可。
 */
export function SceneFilterDefs() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute h-0 w-0"
      style={{ position: "absolute" }}
    >
      <defs>
        {/* 黑白：hue=s=0 → saturate 0 */}
        <filter id={`${FILTER_ID_PREFIX}bw`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
        </filter>

        {/* 鲜艳：eq=saturation=1.45:contrast=1.08
            先饱和 1.45，再对比度 1.08（线性 slope，intercept 居中） */}
        <filter
          id={`${FILTER_ID_PREFIX}vivid`}
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix type="saturate" values="1.45" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.08" intercept="-0.04" />
            <feFuncG type="linear" slope="1.08" intercept="-0.04" />
            <feFuncB type="linear" slope="1.08" intercept="-0.04" />
          </feComponentTransfer>
        </filter>

        {/* 棕褐（做旧）：colorchannelmixer sepia 矩阵，逐系数搬运 */}
        <filter
          id={`${FILTER_ID_PREFIX}sepia`}
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix
            type="matrix"
            values="0.393 0.769 0.189 0 0
                    0.349 0.686 0.168 0 0
                    0.272 0.534 0.131 0 0
                    0 0 0 1 0"
          />
        </filter>

        {/* 暖色：colorbalance=rs=.16:bs=-.12 → R 抬高、B 压低（阴影/中间调近似为整体偏移） */}
        <filter id={`${FILTER_ID_PREFIX}warm`} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="linear" slope="1" intercept="0.08" />
            <feFuncB type="linear" slope="1" intercept="-0.06" />
          </feComponentTransfer>
        </filter>

        {/* 冷色：colorbalance=bs=.18:rs=-.05 → B 抬高、R 压低 */}
        <filter id={`${FILTER_ID_PREFIX}cold`} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncB type="linear" slope="1" intercept="0.09" />
            <feFuncR type="linear" slope="1" intercept="-0.025" />
          </feComponentTransfer>
        </filter>

        {/* 锐化：unsharp 近似为卷积锐化核 */}
        <filter
          id={`${FILTER_ID_PREFIX}sharpen`}
          colorInterpolationFilters="sRGB"
        >
          <feConvolveMatrix
            order="3"
            preserveAlpha="true"
            kernelMatrix="0 -0.5 0 -0.5 3 -0.5 0 -0.5 0"
          />
        </filter>

        {/* 复古：curves=preset=vintage 近似——降对比 + 偏黄绿、提亮阴影 */}
        <filter
          id={`${FILTER_ID_PREFIX}vintage`}
          colorInterpolationFilters="sRGB"
        >
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.12 0.55 0.92" />
            <feFuncG type="table" tableValues="0.08 0.5 0.88" />
            <feFuncB type="table" tableValues="0.15 0.42 0.78" />
          </feComponentTransfer>
          <feColorMatrix type="saturate" values="0.85" />
        </filter>

        {/* 老电影：sepia 矩阵 + 降饱和（噪点/暗角在预览中省略，色调为主） */}
        <filter
          id={`${FILTER_ID_PREFIX}oldfilm`}
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix
            type="matrix"
            values="0.393 0.769 0.189 0 0
                    0.349 0.686 0.168 0 0
                    0.272 0.534 0.131 0 0
                    0 0 0 1 0"
          />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.92" intercept="0.02" />
            <feFuncG type="linear" slope="0.92" intercept="0.02" />
            <feFuncB type="linear" slope="0.92" intercept="0.02" />
          </feComponentTransfer>
        </filter>

        {/* 青橙：colorbalance rs=.2 bs=-.2 + eq saturation=1.25 */}
        <filter
          id={`${FILTER_ID_PREFIX}tealorange`}
          colorInterpolationFilters="sRGB"
        >
          <feComponentTransfer>
            <feFuncR type="linear" slope="1" intercept="0.1" />
            <feFuncB type="linear" slope="1" intercept="-0.1" />
          </feComponentTransfer>
          <feColorMatrix type="saturate" values="1.25" />
        </filter>

        {/* 梦幻紫：colorbalance rs=.1 bs=.25 → R/B 同抬，偏紫 */}
        <filter
          id={`${FILTER_ID_PREFIX}dreampurple`}
          colorInterpolationFilters="sRGB"
        >
          <feComponentTransfer>
            <feFuncR type="linear" slope="1" intercept="0.05" />
            <feFuncB type="linear" slope="1" intercept="0.12" />
          </feComponentTransfer>
        </filter>

        {/* 暗角：用 radialGradient 生成中心透明、四周变暗的遮罩，
            通过 feImage + feComposite 叠乘到画面上 */}
        <filter
          id={`${FILTER_ID_PREFIX}vignette`}
          colorInterpolationFilters="sRGB"
          x="0"
          y="0"
          width="100%"
          height="100%"
        >
          <feImage
            href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cdefs%3E%3CradialGradient id='v' cx='50%25' cy='50%25' r='75%25'%3E%3Cstop offset='55%25' stop-color='white'/%3E%3Cstop offset='100%25' stop-color='%23666'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23v)'/%3E%3C/svg%3E"
            preserveAspectRatio="none"
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="mask"
          />
          <feComposite
            in="SourceGraphic"
            in2="mask"
            operator="arithmetic"
            k1="1"
            k2="0"
            k3="0"
            k4="0"
          />
        </filter>
      </defs>
    </svg>
  );
}
