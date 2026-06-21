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
 * 曲源：FreePD（CC0 公共域，商用免授权、无需署名）经 Internet Archive
 * 镜像批量下载，实体在 public/bgm/<category>/。清单与实体文件名一一对应。
 * 新增曲目：放 mp3 到对应目录 + 此处追加一条 + 重新 build（Next 生产模式
 * 只服务 build 时刻的 public 快照，build 后新增空目录里的文件需重 build 才生效）。
 */
export const BGM_TRACKS: BgmTrack[] = [
  // 舒缓
  {
    id: "calm-singing-bells",
    title: "颂钵",
    category: "calm",
    url: "/bgm/calm/singing-bells.mp3",
    duration: 163,
    credit: "FreePD (CC0)",
  },
  {
    id: "calm-delicate",
    title: "细腻",
    category: "calm",
    url: "/bgm/calm/delicate.mp3",
    duration: 210,
    credit: "FreePD (CC0)",
  },
  {
    id: "calm-piano",
    title: "钢琴小品",
    category: "calm",
    url: "/bgm/calm/calm-piano.mp3",
    duration: 64,
    credit: "FreePD (CC0)",
  },
  // 紧张
  {
    id: "tension-investigation",
    title: "追查",
    category: "tension",
    url: "/bgm/tension/action-investigation.mp3",
    duration: 121,
    credit: "FreePD (CC0)",
  },
  {
    id: "tension-anxiety",
    title: "焦灼",
    category: "tension",
    url: "/bgm/tension/anxiety.mp3",
    duration: 58,
    credit: "FreePD (CC0)",
  },
  {
    id: "tension-chase-pulse",
    title: "追逐脉搏",
    category: "tension",
    url: "/bgm/tension/chase-pulse.mp3",
    duration: 97,
    credit: "FreePD (CC0)",
  },
  // 欢快
  {
    id: "upbeat-80s-rocker",
    title: "复古摇滚",
    category: "upbeat",
    url: "/bgm/upbeat/80s-rocker.mp3",
    duration: 15,
    credit: "FreePD (CC0)",
  },
  {
    id: "upbeat-tibet-groove",
    title: "律动",
    category: "upbeat",
    url: "/bgm/upbeat/tibet-groove.mp3",
    duration: 140,
    credit: "FreePD (CC0)",
  },
  {
    id: "upbeat-cheerleader",
    title: "活力",
    category: "upbeat",
    url: "/bgm/upbeat/cheerleader.mp3",
    duration: 225,
    credit: "FreePD (CC0)",
  },
  // 悬疑
  {
    id: "suspense-obscure-tech",
    title: "暗涌科技",
    category: "suspense",
    url: "/bgm/suspense/obscure-tech.mp3",
    duration: 155,
    credit: "FreePD (CC0)",
  },
  {
    id: "suspense-chill-dark",
    title: "冷夜",
    category: "suspense",
    url: "/bgm/suspense/chill-dark.mp3",
    duration: 196,
    credit: "FreePD (CC0)",
  },
  {
    id: "suspense-creepy",
    title: "诡谲",
    category: "suspense",
    url: "/bgm/suspense/creepy-setting.mp3",
    duration: 112,
    credit: "FreePD (CC0)",
  },
  // 史诗
  {
    id: "epic-monster",
    title: "巨兽",
    category: "epic",
    url: "/bgm/epic/monster.mp3",
    duration: 40,
    credit: "FreePD (CC0)",
  },
  {
    id: "epic-action-intro",
    title: "序章",
    category: "epic",
    url: "/bgm/epic/action-intro.mp3",
    duration: 160,
    credit: "FreePD (CC0)",
  },
  {
    id: "epic-ancient-power",
    title: "远古之力",
    category: "epic",
    url: "/bgm/epic/ancient-power.mp3",
    duration: 109,
    credit: "FreePD (CC0)",
  },
  // 悲伤
  {
    id: "sad-blue-day",
    title: "忧蓝",
    category: "sad",
    url: "/bgm/sad/blue-day.mp3",
    duration: 179,
    credit: "FreePD (CC0)",
  },
  {
    id: "sad-hollywood-tears",
    title: "落泪",
    category: "sad",
    url: "/bgm/sad/hollywood-tears.mp3",
    duration: 166,
    credit: "FreePD (CC0)",
  },
  {
    id: "sad-red-hair-blue-sky",
    title: "红发蓝天",
    category: "sad",
    url: "/bgm/sad/red-hair-blue-sky.mp3",
    duration: 136,
    credit: "FreePD (CC0)",
  },
  // 浪漫
  {
    id: "romance-alison",
    title: "艾莉森",
    category: "romance",
    url: "/bgm/romance/alison.mp3",
    duration: 176,
    credit: "FreePD (CC0)",
  },
  {
    id: "romance-china-love",
    title: "东方恋曲",
    category: "romance",
    url: "/bgm/romance/china-love.mp3",
    duration: 141,
    credit: "FreePD (CC0)",
  },
  {
    id: "romance-loved-respected",
    title: "珍视",
    category: "romance",
    url: "/bgm/romance/loved-respected.mp3",
    duration: 310,
    credit: "FreePD (CC0)",
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
