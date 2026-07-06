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

/** 挂在项目详情上的系列上下文（编辑器消费：徽标、上下集跳转、世界观预填） */
export interface ProjectSeriesInfo {
  id: string;
  title: string;
  genre: string | null;
  worldview: string | null;
  protagonist: string | null;
  episodes: SeriesEpisodeRef[];
}
