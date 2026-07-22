/**
 * 剪映（JianYing）/ CapCut 草稿 draft_content.json 组装（纯函数，无 IO）。
 *
 * 供服务层 services/jianying-draft.ts 调用：输入「时间轴描述」（逐镜素材相对文件名 +
 * 时长 + 字幕句），输出 draft_content.json 对象。字段结构以社区权威参考实现
 * pyJianYingDraft v0.3.0 源码为唯一真源（本文件每处字段均对齐其 export_json）：
 *   - 顶层模板：assets/draft_content_template.json（5.9.0 明文，version 360000）
 *   - 素材：local_materials.py（VideoMaterial/AudioMaterial）、text_segment.py（文本素材）
 *   - 片段：segment.py（BaseSegment/MediaSegment/VisualSegment/Speed）、
 *           video_segment.py、audio_segment.py
 *   - 轨道/汇总：track.py、script_material.py、script_file.py（dumps 顺序与 render_index）
 *
 * 时间单位一律微秒（μs），1 秒 = 1_000_000（对齐 time_util.py 的 SEC）。
 *
 * ── 素材路径可移植性（硬要求：zip 解压即开，无「媒体丢失」）──
 * 参考库把素材 path 写成绝对路径，无法跨机迁移。剪映的自包含机制是把 path 写成占位符
 * token：`##_draftpath_placeholder_<大写UUID>_##/material/<文件名>`。剪映打开草稿时把该
 * 占位符解析为「当前草稿文件夹的绝对路径」，故只要素材落在草稿文件夹的 material/ 子目录，
 * 解压到任意机器的剪映草稿目录都能正确定位，不弹「媒体丢失」。整份草稿的所有素材 path 共用
 * 同一个大写 UUID（由服务层生成后经 pathPlaceholderUuid 传入）。
 *
 * lib 层不依赖 services（依赖分层硬约束）；仅依赖同为 lib 的 subtitle-segments（未直接引，
 * 切句/分配窗在服务层完成后把逐句窗传进来，保持本文件纯粹）。
 */

/** 一秒对应的微秒数（对齐 pyJianYingDraft time_util.py 的 SEC） */
export const MICROS_PER_SECOND = 1_000_000;

/** 图片素材的固定时长（≈3h，对齐 local_materials.py:154，图片可在任意时长内取用） */
export const PHOTO_MATERIAL_DURATION_US = 10_800_000_000;

/** 秒 → 微秒（四舍五入取整，时间轴一律整数微秒） */
export function secondsToMicros(seconds: number): number {
  return Math.round(seconds * MICROS_PER_SECOND);
}

/** 生成 32 位十六进制无连字符 id（对齐参考库 uuid4().hex，用于素材/片段/轨道全局 id） */
function genHexId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** 拼接草稿内自包含素材路径占位符（见文件头「素材路径可移植性」） */
export function buildDraftMaterialPath(
  placeholderUuid: string,
  fileName: string
): string {
  return `##_draftpath_placeholder_${placeholderUuid}_##/material/${fileName}`;
}

// ── 输入类型 ────────────────────────────────────────────────────────────────

/** 单个正片镜头（视频或图片），按时间顺序排列 */
export interface DraftVideoShot {
  /** 素材类型：视频轨用视频，无视频时用图片铺满镜头时长 */
  kind: "video" | "photo";
  /** material/ 子目录下的文件名（拼占位符路径 + 素材去重键） */
  materialFileName: string;
  /** 素材像素宽 */
  materialWidth: number;
  /** 素材像素高 */
  materialHeight: number;
  /** 素材时长（μs）：视频=ffprobe 实测；图片=PHOTO_MATERIAL_DURATION_US */
  materialDurationUs: number;
  /** 镜头在视频轨上的起点（μs，逐镜累加，闭合无缝） */
  startUs: number;
  /** 镜头时长（μs，= scene.duration；即 target_timerange.duration） */
  durationUs: number;
}

/** 单条配音片段（对齐某镜起点） */
export interface DraftVoiceClip {
  /** material/ 下文件名 */
  materialFileName: string;
  /** 配音素材实测时长（μs） */
  materialDurationUs: number;
  /** 在音轨上的起点（μs，= 对应镜起点） */
  startUs: number;
  /** 片段时长（μs，= min(配音实长, 镜头时长)） */
  durationUs: number;
}

/** 全片背景音乐（单条主音乐） */
export interface DraftBgm {
  /** material/ 下文件名 */
  materialFileName: string;
  /** BGM 素材实测时长（μs） */
  materialDurationUs: number;
  /** 全片总时长（μs，BGM 铺到全片；实长不足则后段静音，剪映草稿无法表达循环） */
  totalDurationUs: number;
  /** 音量 0-1（相对原始 BGM，缺省 0.25，与导出混音 BGM 缺省增益一致） */
  volume: number;
}

/** 单句字幕（已由服务层用 subtitle-segments 切句 + 分配时间窗） */
export interface DraftSubtitle {
  /** 句子文本 */
  text: string;
  /** 在文本轨上的起点（μs） */
  startUs: number;
  /** 显示时长（μs） */
  durationUs: number;
}

/** buildJianyingDraft 的完整输入 */
export interface DraftTimelineInput {
  /** 画布宽 px */
  width: number;
  /** 画布高 px */
  height: number;
  /** 帧率（缺省 30） */
  fps: number;
  /** 全草稿共用的大写 UUID（素材路径占位符，见文件头） */
  pathPlaceholderUuid: string;
  /** 逐镜正片（视频/图片），按时间顺序 */
  videoShots: DraftVideoShot[];
  /** 配音片段 */
  voiceClips: DraftVoiceClip[];
  /** 背景音乐（可选） */
  bgm?: DraftBgm;
  /** 逐句字幕 */
  subtitles: DraftSubtitle[];
}

// ── 输出类型（draft_content.json，只声明本文件写入/读取的字段，其余保留模板） ──

/** draft_content.json 顶层对象（宽松结构：模板字段众多，仅强类型化本文件覆盖的部分） */
export type JianyingDraftContent = Record<string, unknown> & {
  canvas_config: { width: number; height: number; ratio: string };
  fps: number;
  duration: number;
  materials: Record<string, unknown[]>;
  tracks: JianyingTrack[];
};

/** 轨道 JSON（对齐 track.py:180-189） */
export interface JianyingTrack {
  attribute: number;
  flag: number;
  id: string;
  is_default_name: boolean;
  name: string;
  segments: Record<string, unknown>[];
  type: "video" | "audio" | "text";
}

// ── 内部：素材 / 片段 / 轨道构造 ─────────────────────────────────────────────

/** Speed 对象（对齐 segment.py:79-98；每个媒体片段必带一个，进 materials.speeds + extra_material_refs[0]） */
function buildSpeed(): { id: string; json: Record<string, unknown> } {
  const id = genHexId();
  return {
    id,
    json: { curve_speed: null, id, mode: 0, speed: 1.0, type: "speed" },
  };
}

/** 视频/图片素材 JSON（对齐 local_materials.py:160-180 VideoMaterial.export_json） */
function buildVideoMaterial(params: {
  id: string;
  path: string;
  fileName: string;
  durationUs: number;
  width: number;
  height: number;
  type: "video" | "photo";
}): Record<string, unknown> {
  return {
    audio_fade: null,
    category_id: "",
    category_name: "local",
    check_flag: 63487,
    crop: {
      upper_left_x: 0.0,
      upper_left_y: 0.0,
      upper_right_x: 1.0,
      upper_right_y: 0.0,
      lower_left_x: 0.0,
      lower_left_y: 1.0,
      lower_right_x: 1.0,
      lower_right_y: 1.0,
    },
    crop_ratio: "free",
    crop_scale: 1.0,
    duration: params.durationUs,
    height: params.height,
    id: params.id,
    local_material_id: "",
    material_id: params.id,
    material_name: params.fileName,
    media_path: "",
    path: params.path,
    type: params.type,
    width: params.width,
  };
}

/** 音频素材 JSON（对齐 local_materials.py:229-247 AudioMaterial.export_json） */
function buildAudioMaterial(params: {
  id: string;
  path: string;
  fileName: string;
  durationUs: number;
}): Record<string, unknown> {
  return {
    app_id: 0,
    category_id: "",
    category_name: "local",
    check_flag: 3,
    copyright_limit_type: "none",
    duration: params.durationUs,
    effect_id: "",
    formula_id: "",
    id: params.id,
    local_material_id: params.id,
    music_id: params.id,
    name: params.fileName,
    path: params.path,
    source_platform: 0,
    type: "extract_music",
    wave_points: [],
  };
}

/** 文本素材 JSON（对齐 text_segment.py:384-457 export_material，仅基础白字样式） */
function buildTextMaterial(id: string, text: string): Record<string, unknown> {
  // content 是 JSON-in-JSON 字符串（对齐 text_segment.py:395-417 / 433）：
  // 白字 solid [1,1,1]，range=[0, 文本长度]，无描边/背景/阴影。
  const contentJson = {
    styles: [
      {
        fill: {
          alpha: 1.0,
          content: {
            render_type: "solid",
            solid: { alpha: 1.0, color: [1.0, 1.0, 1.0] },
          },
        },
        range: [0, text.length],
        size: 8.0,
        bold: false,
        italic: false,
        underline: false,
        strokes: [],
      },
    ],
    text,
  };
  return {
    id,
    content: JSON.stringify(contentJson),
    typesetting: 0,
    alignment: 1, // 居中（TextStyle align=1）
    letter_spacing: 0, // 0 * 0.05
    line_spacing: 0.02, // 0.02 + 0 * 0.05
    line_feed: 1,
    line_max_width: 0.82,
    force_apply_line_max_width: false,
    check_flag: 7, // 无描边/背景/阴影
    type: "subtitle", // auto_wrapping=true → "subtitle"（对齐 text_segment.py:446）
    global_alpha: 1.0,
  };
}

/** 片段通用字段（对齐 segment.py:55-77 BaseSegment.export_json） */
function baseSegmentJson(
  segmentId: string,
  materialId: string,
  startUs: number,
  durationUs: number
): Record<string, unknown> {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: segmentId,
    material_id: materialId,
    target_timerange: { start: startUs, duration: durationUs },
    common_keyframes: [],
    keyframe_refs: [],
  };
}

/** 图像调节设置（对齐 segment.py:171-179 ClipSettings.export_json，默认不变换） */
function defaultClip(): Record<string, unknown> {
  return {
    alpha: 1.0,
    flip: { horizontal: false, vertical: false },
    rotation: 0.0,
    scale: { x: 1.0, y: 1.0 },
    transform: { x: 0.0, y: 0.0 },
  };
}

// ── 主函数 ──────────────────────────────────────────────────────────────────

/**
 * 组装 draft_content.json 对象。
 *
 * 轨道自下而上（导出数组顺序 = track_order 升序，值越大越靠前景）：
 *   0 video（正片视频/图片）→ 1 audio「配音」→ 2 audio「背景音乐」→ 3 text（字幕，最上层）
 * dumps 时给每个 segment 写 render_index = 该轨道导出序号（对齐 script_file.py:128-132）。
 *
 * 素材去重：多镜引用同一 materialFileName 时 materials 只出一条，各镜片段共享同一 material_id。
 *
 * @param input 时间轴描述
 * @returns draft_content.json 对象（可直接 JSON.stringify 落盘）
 */
export function buildJianyingDraft(
  input: DraftTimelineInput
): JianyingDraftContent {
  // 各类目素材（最终写入 materials）
  const videoMaterials: Record<string, unknown>[] = [];
  const audioMaterials: Record<string, unknown>[] = [];
  const textMaterials: Record<string, unknown>[] = [];
  const speedMaterials: Record<string, unknown>[] = [];

  // 素材去重表：fileName → material id（同素材复用一条）
  const videoMaterialIdByFile = new Map<string, string>();
  const audioMaterialIdByFile = new Map<string, string>();

  /** 取/建视频素材 id（按 fileName 去重） */
  const ensureVideoMaterial = (shot: DraftVideoShot): string => {
    const existing = videoMaterialIdByFile.get(shot.materialFileName);
    if (existing) return existing;
    const id = genHexId();
    videoMaterialIdByFile.set(shot.materialFileName, id);
    videoMaterials.push(
      buildVideoMaterial({
        id,
        path: buildDraftMaterialPath(
          input.pathPlaceholderUuid,
          shot.materialFileName
        ),
        fileName: shot.materialFileName,
        durationUs: shot.materialDurationUs,
        width: shot.materialWidth,
        height: shot.materialHeight,
        type: shot.kind,
      })
    );
    return id;
  };

  /** 取/建音频素材 id（按 fileName 去重） */
  const ensureAudioMaterial = (
    fileName: string,
    durationUs: number
  ): string => {
    const existing = audioMaterialIdByFile.get(fileName);
    if (existing) return existing;
    const id = genHexId();
    audioMaterialIdByFile.set(fileName, id);
    audioMaterials.push(
      buildAudioMaterial({
        id,
        path: buildDraftMaterialPath(input.pathPlaceholderUuid, fileName),
        fileName,
        durationUs,
      })
    );
    return id;
  };

  // ── 视频轨片段 ──
  const videoSegments: Record<string, unknown>[] = [];
  for (const shot of input.videoShots) {
    const materialId = ensureVideoMaterial(shot);
    const speed = buildSpeed();
    speedMaterials.push(speed.json);

    // source_timerange.end 不得超素材时长（对齐 video_segment.py:454）：
    // source 取 min(素材实长, 镜头时长)；图片素材时长≈3h，恒能容纳镜头时长。
    const sourceDurationUs = Math.min(shot.materialDurationUs, shot.durationUs);
    // 剪映的片段时间不变式：source.duration = target.duration * speed（video_segment.py:449）。
    // 视频实长 < 镜头时长时（source < target），必须把 speed 设为 source/target（<1，即慢放拉伸），
    // 让短视频铺满整个镜头且首尾对齐——这与参考库 pyJianYingDraft 完全一致。若强行 speed=1.0
    // 会破坏该不变式（source≠target*speed），剪映可能只播 source 段后留空档而非铺满。
    // 图片素材（source==target）speed 恒为 1。
    const speedRatio =
      shot.durationUs > 0 ? sourceDurationUs / shot.durationUs : 1;

    const seg = baseSegmentJson(
      genHexId(),
      materialId,
      shot.startUs,
      shot.durationUs
    );
    speed.json.speed = speedRatio; // 变速素材与片段 speed 字段须同值
    videoSegments.push({
      ...seg,
      source_timerange: { start: 0, duration: sourceDurationUs },
      speed: speedRatio,
      volume: 1.0,
      extra_material_refs: [speed.id],
      is_tone_modify: false,
      clip: defaultClip(),
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    });
  }

  // ── 配音轨片段 ──
  const voiceSegments: Record<string, unknown>[] = [];
  for (const clip of input.voiceClips) {
    const materialId = ensureAudioMaterial(
      clip.materialFileName,
      clip.materialDurationUs
    );
    const speed = buildSpeed();
    speedMaterials.push(speed.json);

    const durationUs = Math.min(clip.materialDurationUs, clip.durationUs);
    const seg = baseSegmentJson(
      genHexId(),
      materialId,
      clip.startUs,
      durationUs
    );
    voiceSegments.push({
      ...seg,
      source_timerange: { start: 0, duration: durationUs },
      speed: 1.0,
      volume: 1.0,
      extra_material_refs: [speed.id],
      is_tone_modify: false,
      clip: null,
      hdr_settings: null,
    });
  }

  // ── BGM 轨片段（可选，单条） ──
  const bgmSegments: Record<string, unknown>[] = [];
  if (input.bgm) {
    const materialId = ensureAudioMaterial(
      input.bgm.materialFileName,
      input.bgm.materialDurationUs
    );
    const speed = buildSpeed();
    speedMaterials.push(speed.json);

    // BGM 铺到全片；实长不足时 source 只取实长（后段静音，剪映草稿无法表达循环铺满）。
    const durationUs = Math.min(
      input.bgm.materialDurationUs,
      input.bgm.totalDurationUs
    );
    const seg = baseSegmentJson(genHexId(), materialId, 0, durationUs);
    bgmSegments.push({
      ...seg,
      source_timerange: { start: 0, duration: durationUs },
      speed: 1.0,
      volume: input.bgm.volume,
      extra_material_refs: [speed.id],
      is_tone_modify: false,
      clip: null,
      hdr_settings: null,
    });
  }

  // ── 字幕轨片段 ──
  const textSegments: Record<string, unknown>[] = [];
  for (const sub of input.subtitles) {
    const materialId = genHexId();
    textMaterials.push(buildTextMaterial(materialId, sub.text));
    const seg = baseSegmentJson(
      genHexId(),
      materialId,
      sub.startUs,
      sub.durationUs
    );
    textSegments.push({
      ...seg,
      // 文本片段无 source_timerange（贴纸/文本对源无截取），但走 VisualSegment 有 clip/uniform_scale。
      // 参考库 TextSegment 经 MediaSegment.export_json 会写 source_timerange:null / speed / volume。
      source_timerange: null,
      speed: 1.0,
      volume: 1.0,
      extra_material_refs: [],
      is_tone_modify: false,
      clip: defaultClip(),
      uniform_scale: { on: true, value: 1.0 },
    });
  }

  // ── 轨道（按导出序，render_index = 数组下标） ──
  const tracks: JianyingTrack[] = [];
  const orderedTrackDefs: Array<{
    type: "video" | "audio" | "text";
    name: string;
    segments: Record<string, unknown>[];
  }> = [
    { type: "video", name: "视频", segments: videoSegments },
    { type: "audio", name: "配音", segments: voiceSegments },
    { type: "audio", name: "背景音乐", segments: bgmSegments },
    { type: "text", name: "字幕", segments: textSegments },
  ];

  orderedTrackDefs.forEach((def, exportIndex) => {
    // 空轨（如无配音/无 BGM/无字幕）也保留，保证轨道结构稳定（剪映允许空轨）。
    const segments = def.segments.map((s) => ({
      ...s,
      render_index: exportIndex,
      track_render_index: 0,
    }));
    tracks.push({
      attribute: 0,
      flag: 0,
      id: genHexId(),
      is_default_name: def.name.length === 0,
      name: def.name,
      segments,
      type: def.type,
    });
  });

  // ── 全片时长 = 所有片段 end 的最大值 ──
  let duration = 0;
  for (const track of tracks) {
    for (const seg of track.segments) {
      const tr = seg.target_timerange as { start: number; duration: number };
      duration = Math.max(duration, tr.start + tr.duration);
    }
  }

  // ── materials：所有类目键都要在（对齐 script_material.py:99-147），空的给 [] ──
  const materials: Record<string, unknown[]> = {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audio_track_indexes: [],
    audios: audioMaterials,
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_deformations: [],
    masks: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    smart_relights: [],
    sound_channel_mappings: [],
    speeds: speedMaterials,
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: textMaterials,
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_trackings: [],
    videos: videoMaterials,
    vocal_beautifys: [],
    vocal_separations: [],
  };

  // ── 以 5.9.0 明文模板为基底，覆盖 canvas/fps/duration/materials/tracks ──
  return {
    ...buildContentTemplate(),
    canvas_config: {
      width: input.width,
      height: input.height,
      ratio: "original",
    },
    fps: input.fps,
    duration,
    materials,
    tracks,
    // 顶层 id 每份草稿唯一（模板固定值会导致同机多草稿冲突）
    id: crypto.randomUUID().toUpperCase(),
  };
}

/**
 * draft_content.json 顶层模板（5.9.0 明文，version 360000）。
 *
 * 逐字段对齐 pyJianYingDraft assets/draft_content_template.json；此处内联一份而非读文件，
 * 保持 lib 纯函数无 IO。buildJianyingDraft 会覆盖 canvas_config / fps / duration /
 * materials / tracks / id，其余字段（config / platform / keyframes 等）保留模板值。
 */
function buildContentTemplate(): Record<string, unknown> {
  return {
    canvas_config: { height: 1080, ratio: "original", width: 1920 },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: "none",
      multi_language_list: [],
      multi_language_main: "none",
      multi_language_mode: "none",
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: 0,
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: "00000000-0000-0000-0000-000000000000",
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: [],
    },
    last_modified_platform: {
      app_id: 3704,
      app_source: "lv",
      app_version: "5.9.0",
      os: "windows",
    },
    platform: {
      app_id: 3704,
      app_source: "lv",
      app_version: "5.9.0",
      os: "windows",
    },
    materials: {},
    mutable_config: null,
    name: "",
    new_version: "110.0.0",
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks: [],
    update_time: 0,
    version: 360000,
  };
}

/**
 * draft_meta_info.json 内容（自包含草稿最小文件集之一，对齐 assets/draft_meta_info.json）。
 *
 * draft_fold_path / draft_root_path 留空（剪映打开时自建）；draft_id 每份草稿唯一，
 * draft_name = 项目名。draft_materials 保留空 registry（剪映靠 draft_content.json 的
 * materials + 占位符 path 定位素材，此处无需逐条填）。
 *
 * @param draftName 草稿名（项目名）
 * @returns draft_meta_info.json 对象
 */
export function buildDraftMetaInfo(draftName: string): Record<string, unknown> {
  return {
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "",
    draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "",
      draft_enterprise_id: "",
      draft_enterprise_name: "",
      enterprise_material: [],
    },
    draft_fold_path: "",
    draft_id: crypto.randomUUID().toUpperCase(),
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: draftName,
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: "",
    draft_segment_extra_info: [],
    draft_type: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
    tm_duration: 0,
  };
}
