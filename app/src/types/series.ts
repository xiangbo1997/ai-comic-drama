/**
 * 系列（多集漫剧）相关类型定义
 */

/** 系列摘要（项目列表页分组头 + 系列管理用） */
export interface SeriesSummary {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  style: string;
  aspectRatio: string;
  worldview: string | null;
  protagonist: string | null;
  episodeCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 系列内单集的轻量引用（上下集导航用） */
export interface SeriesEpisodeRef {
  id: string;
  title: string;
  episodeNumber: number | null;
}

/** 系列故事圣经的编辑器展示摘要（不含全量圣经；史官维护的跨集记忆概览） */
export interface SeriesBibleSummary {
  /** 主题锁（一句话） */
  theme: string | null;
  /** 未解决伏笔数 */
  openThreads: number;
  /** 已归档集数 */
  episodeCount: number;
  /** 最后一集结尾钩子 */
  lastEpisodeHook: string | null;
}

/** 挂在项目详情上的系列上下文（编辑器消费：徽标、上下集跳转、世界观预填） */
export interface ProjectSeriesInfo {
  id: string;
  title: string;
  genre: string | null;
  worldview: string | null;
  protagonist: string | null;
  episodes: SeriesEpisodeRef[];
  /** 系列记忆摘要（有归档时非 null，供编辑器展示 + 刷新入口） */
  bibleSummary?: SeriesBibleSummary | null;
  /**
   * 本集在故事圣经里的结尾钩子（预览端片尾钩子卡文案；null=用通用追更文案兜底）。
   * 与导出端共用 lib/series.resolveEpisodeEndingHook，保证预览/导出同文案。
   */
  episodeEndingHook?: string | null;
}
