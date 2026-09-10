/**
 * 竖屏平台 UI 安全区 —— 导出端与预览端的单一真源。
 *
 * ── 为什么需要 ──
 * 成片在网页预览里怎么看都正常，一旦上传到抖音/快手，平台会在画面之上叠一层
 * 自己的 UI（作者昵称、文案、话题、进度条、右侧互动按钮、顶部 Tab）。落在这些
 * 区域里的字幕 / 水印 / AI 标识会被**整块盖住**，而且只有真机发布后才暴露。
 * 因此所有「贴边元素」的默认位置与 clamp 范围都必须收敛到本文件给出的范围内。
 *
 * ── 数值来源 ──
 * 以 1080×1920（9:16）为基准的实测像素量，换算成归一化比例。均为工程取值
 * （平台 UI 会随版本变动），不是任何规范的硬性阈值：
 *   - top    0.135 ≈ 260px：状态栏 + 平台顶部 Tab（推荐/关注/同城）；
 *   - bottom 0.80  ≈ 384px：作者昵称 + 文案 + 话题 + 底部播放进度条；
 *   - right  0.86  ≈ 150px：右侧竖排互动按钮（头像/点赞/评论/收藏/分享/转盘）。
 *
 * ── 语义 ──
 * 三个值都是「内容可用区的边界」：
 *   合法纵向范围 = [top, bottom]，合法横向范围 = [1 - right, right]（左右对称）。
 * 横屏 / 方形项目不受平台竖屏 UI 影响，但统一套用同一安全区可保证跨画幅一致，
 * 且代价仅是少量留白，故不做画幅分支（保持单一真源，避免两套 clamp 漂移）。
 */

/** 竖屏 9:16 平台 UI 安全区（抖音/快手实测值，归一化坐标） */
export const VERTICAL_SAFE = {
  /** 内容可用区上边界：其上为状态栏 + 平台顶部 Tab */
  top: 0.135,
  /** 内容可用区下边界：其下为作者信息 / 文案 / 话题 / 进度条 */
  bottom: 0.8,
  /** 内容可用区右边界：其右为右侧竖排互动按钮 */
  right: 0.86,
} as const;

/** 内容可用区左边界（与 right 对称，左侧无平台常驻元素，仅留等量视觉边距） */
export const VERTICAL_SAFE_LEFT = 1 - VERTICAL_SAFE.right;

/**
 * 把归一化纵坐标夹取到安全区 [top, bottom]。
 *
 * 用于字幕默认位置解析与拖拽落点：越过边界的坐标会被平台 UI 遮挡，
 * 与其让用户导出后才发现，不如在设置时就拦住。
 */
export function clampSafeY(y: number): number {
  if (!Number.isFinite(y)) return VERTICAL_SAFE.bottom;
  return Math.min(VERTICAL_SAFE.bottom, Math.max(VERTICAL_SAFE.top, y));
}

/**
 * 把归一化横坐标夹取到安全区 [1-right, right]。
 */
export function clampSafeX(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(VERTICAL_SAFE.right, Math.max(VERTICAL_SAFE_LEFT, x));
}
