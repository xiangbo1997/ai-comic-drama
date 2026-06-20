/**
 * 内置背景音乐（BGM）曲库清单。
 *
 * 内置曲为固定静态资产，放在 `public/bgm/<category>/<file>.mp3`，
 * 随构建发布、由 Next static 直接服务，URL 形如 `/bgm/epic/rise.mp3`。
 * video-synthesis 的 absolutizeUrl() 会自动补成绝对地址给 ffmpeg 拉取——
 * 与 watermark/sticker 资产同机制，不入 DB、不走 storage.ts。
 *
 * 版权：仅收录 CC0 / Pixabay License 等商用免授权、无需署名的曲目，规避风险。
 * 新增曲目：把 mp3 放到对应分类目录，并在 BGM_TRACKS 追加一条即可。
 */

export interface BgmCategory {
  /** 分类 id（与剧情情绪标签对齐，便于一键匹配） */
  id: string;
  /** 中文标签 */
  label: string;
}

export interface BgmTrack {
  /** 稳定 id，如 "epic-rise"（前端回显选中态用） */
  id: string;
  /** 曲名 */
  title: string;
  /** 所属分类 id */
  category: string;
  /** 静态资源 URL，如 "/bgm/epic/rise.mp3" */
  url: string;
  /** 时长（秒），用于 UI 显示与试听进度 */
  duration: number;
  /** 署名/来源（CC0 可空，留作合规留痕） */
  credit?: string;
}

/** 七类漫剧情绪分类 */
export const BGM_CATEGORIES: BgmCategory[] = [
  { id: "calm", label: "舒缓" },
  { id: "tension", label: "紧张" },
  { id: "upbeat", label: "欢快" },
  { id: "suspense", label: "悬疑" },
  { id: "epic", label: "史诗" },
  { id: "sad", label: "悲伤" },
  { id: "romance", label: "浪漫" },
];

/**
 * 内置曲目清单。
 *
 * 注：mp3 实体需放到 public/bgm/<category>/ 下（见 scripts/fetch-bgm.mjs
 * 可批量拉取 CC0 曲库）。清单与实体文件名一一对应；缺文件的条目前端会
 * 试听失败但不影响其它曲目。下方为首批曲目占位（文件名已规划），
 * 放入对应 mp3 后立即生效。
 */
export const BGM_TRACKS: BgmTrack[] = [
  // 舒缓
  {
    id: "calm-morning-light",
    title: "晨光",
    category: "calm",
    url: "/bgm/calm/morning-light.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "calm-still-water",
    title: "静水",
    category: "calm",
    url: "/bgm/calm/still-water.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  // 紧张
  {
    id: "tension-heartbeat",
    title: "心跳",
    category: "tension",
    url: "/bgm/tension/heartbeat.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "tension-on-the-edge",
    title: "临界",
    category: "tension",
    url: "/bgm/tension/on-the-edge.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  // 欢快
  {
    id: "upbeat-sunny-day",
    title: "晴日",
    category: "upbeat",
    url: "/bgm/upbeat/sunny-day.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "upbeat-good-vibes",
    title: "好心情",
    category: "upbeat",
    url: "/bgm/upbeat/good-vibes.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  // 悬疑
  {
    id: "suspense-shadows",
    title: "暗影",
    category: "suspense",
    url: "/bgm/suspense/shadows.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "suspense-the-clue",
    title: "线索",
    category: "suspense",
    url: "/bgm/suspense/the-clue.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  // 史诗
  {
    id: "epic-rise",
    title: "崛起",
    category: "epic",
    url: "/bgm/epic/rise.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "epic-final-battle",
    title: "决战",
    category: "epic",
    url: "/bgm/epic/final-battle.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  // 悲伤
  {
    id: "sad-farewell",
    title: "离别",
    category: "sad",
    url: "/bgm/sad/farewell.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "sad-rainy-memory",
    title: "雨忆",
    category: "sad",
    url: "/bgm/sad/rainy-memory.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  // 浪漫
  {
    id: "romance-first-meet",
    title: "初见",
    category: "romance",
    url: "/bgm/romance/first-meet.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
  {
    id: "romance-warm-heart",
    title: "暖心",
    category: "romance",
    url: "/bgm/romance/warm-heart.mp3",
    duration: 0,
    credit: "Pixabay License",
  },
];

/** 按分类取曲目 */
export function getBgmTracksByCategory(categoryId: string): BgmTrack[] {
  return BGM_TRACKS.filter((t) => t.category === categoryId);
}

/** 按 id 取单曲 */
export function getBgmTrackById(id: string): BgmTrack | undefined {
  return BGM_TRACKS.find((t) => t.id === id);
}
