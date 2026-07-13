/**
 * 画风预设包（Style Pack）——画风的单一真源
 *
 * 把原先散落在 image-prompt.ts 的一行式风格前缀升级为「画风包」：
 * 每个包含英文风格锚定词（anchor）+ 中文分层色彩系统（colorSystem）+
 * 情绪色盘（moodPalettes）+ 角色定妆规则（characterRules）+ 场景规则（sceneRules）+
 * 英文风格特化负向词（negative）。出图 prompt 层与 UI 均从此注册表消费，避免多处重复。
 *
 * 内容改编自 HBAI-Ltd/Toonflow-app（Apache-2.0）的 art_skills 风格库
 * （2D_90s_japanese_anime / 2D_chinese_guofeng / 3D_anime_render /
 * 3D_guofeng_cyber / 2D_mature_urban_romance），翻译并压缩为提示词预算内的精炼版本。
 *
 * ⚠️ 依赖纪律：本文件零导入其它 app 代码（客户端组件会 import 它），
 * 必须无副作用、无外部依赖，仅纯数据 + 微型查表。
 */

/** 画风包结构 */
export interface StylePack {
  /** Project.style 存储值（画风 id） */
  id: string;
  /** 中文名（UI 显示） */
  label: string;
  /** 一句话说明（UI 副标题） */
  description: string;
  /** 英文风格锚定词（≤220 chars，进图像 prompt 前缀） */
  anchor: string;
  /**
   * 中文分层色彩系统（≤600 chars）：
   * L1 硬约束（肤/发/主服基调）+ L2 软约束（场景/配饰）+ L3 例外机制 + 色温/饱和度区间。
   */
  colorSystem: string;
  /** 中文情绪色盘（≤500 chars）：4-6 个情绪场景 → 主色 + 辅色 + 光效关键词。 */
  moodPalettes: string;
  /** 中文角色定妆风格补充（≤400 chars）：线条/头身比默认/肤感/背景色值。 */
  characterRules: string;
  /** 中文场景生成风格补充（≤300 chars）：空间质感/光影语言。 */
  sceneRules: string;
  /** 英文风格特化负向词（一行）。 */
  negative: string;
  /** 旧平面风格（无完整包内容时 true，colorSystem 等可为空串）。 */
  legacy?: boolean;
}

/**
 * 画风包注册表 —— 数组顺序即 UI 展示顺序。
 * 先展示 4 个存量常用风格 + 5 个 Toonflow 改编的完整画风包，
 * 再放 5 个旧平面 fallback 风格（仅查表兜底，legacy:true）。
 */
export const STYLE_PACKS: readonly StylePack[] = [
  // ========== 存量常用风格（保留原 anchor 语义 + 轻度增强） ==========
  {
    id: "anime",
    label: "日漫风格",
    description: "通用二次元动画，清晰线条、明快配色",
    anchor:
      "anime style, Japanese animation, cel shading, clean crisp linework, vibrant flat colors, expressive eyes",
    colorSystem:
      "L1 硬约束：肤色暖调米白、发色/瞳色以设定为准（黑/棕/金），主服底色低饱和。L2 软约束：场景/配饰色随镜头氛围微调。L3 例外：回忆/高潮镜头可局部提饱和。色温中性偏暖 5000-5400K，饱和度中 55-70%，避免高饱和荧光色。",
    moodPalettes:
      "日常温馨：暖黄主色+米白辅，柔和均匀光；心动瞬间：樱花粉主色+暖橙辅，肤色微红提亮；紧张对峙：冷蓝主色+墨黑辅，硬光高对比；黄昏抒情：琥珀暖主色+暖橙辅，逆光轮廓光；夜色独处：天空蓝主色+淡紫辅，冷调暖点。",
    characterRules:
      "线条：清晰流畅描边，赛璐璐平涂上色；头身比默认 6.5-7 头身；肤感：平涂柔和光泽、无数字化磨皮痕迹；三视图/定妆照统一面容·发型·基础服装，纯白或浅灰背景 #F5F0E8。",
    sceneRules:
      "空间必须有前/中/后景纵深；线条清晰+块面阴影；柔和电影光，单一光源逻辑；避免纯色无场景背景。",
    negative:
      "3d render, photorealistic, real photo, realistic skin texture, neon fluorescent colors",
  },
  {
    id: "realistic",
    label: "写实风格",
    description: "照片级真实感，电影级布光与质感",
    anchor:
      "photorealistic, highly detailed, cinematic lighting, natural skin texture, shallow depth of field, 8k resolution",
    colorSystem:
      "L1 硬约束：肤色贴合真实肤质与光照、发色自然。L2 软约束：环境色遵循真实物理光照。L3 例外：调色可做电影级色彩分级（如青橙对比）。色温随场景光源真实还原，饱和度中低 40-60%，避免卡通化平涂。",
    moodPalettes:
      "白昼自然：中性白主色+柔和阴影，均匀自然光；黄金时刻：暖橙主色+金黄辅，长柔阴影+轮廓光；夜景都市：冷蓝主色+暖灯点缀，霓虹反光；室内温馨：暖黄主色+木色辅，暖侧光。",
    characterRules:
      "追求真实骨相与皮肤质感（毛孔/次表面散射），自然光影建模；三视图/定妆照保持同一人物身份与真实肤质，中性灰背景，避免卡通比例。",
    sceneRules:
      "真实空间透视与材质质感，物理正确的光影与阴影；空气透视表现纵深；避免插画平涂感。",
    negative:
      "cartoon, anime, painting, illustration, sketch, cel shading, flat colors",
  },
  {
    id: "comic",
    label: "漫画风格",
    description: "美式漫画，粗描边、强对比、动态构图",
    anchor:
      "comic book style, bold black outlines, dynamic composition, cel shading, halftone shading, high contrast ink",
    colorSystem:
      "L1 硬约束：主色块高对比、描边墨黑。L2 软约束：辅色用互补色制造冲击。L3 例外：情绪高潮可用大面积单色填充。整体饱和度中高 60-80%，强调块面对比，避免柔焦渐变。",
    moodPalettes:
      "英雄登场：主色红/蓝对撞，硬光高对比；紧张战斗：墨黑主色+橙红辅，速度线+强阴影；悬疑推理：冷青主色+暗部墨黑，低调打光；胜利时刻：金黄主色+暖橙辅，全局提亮。",
    characterRules:
      "线条：粗黑描边+网点阴影，块面平涂上色；头身比英雄式 7-8 头身；肤感：块面高光无渐变；三视图/定妆照保持同一人物剪影与描边风格，纯白背景。",
    sceneRules:
      "强透视与动态构图，块面光影+网点质感；背景可简化聚焦主体；避免柔和写实光。",
    negative:
      "photo, 3d, realistic skin texture, soft shading, gradient, blurry",
  },
  {
    id: "watercolor",
    label: "水彩风格",
    description: "水彩晕染，柔边、流动色彩、清透质感",
    anchor:
      "watercolor painting style, soft bleeding edges, flowing translucent washes, paper texture, gentle gradients, delicate brushwork",
    colorSystem:
      "L1 硬约束：色彩清透、留白呼吸感。L2 软约束：邻近色晕染过渡。L3 例外：情绪浓烈处可叠色加深。整体饱和度中低 40-60%，色温偏柔和，避免生硬边界与数字锐利线。",
    moodPalettes:
      "清晨微光：淡蓝主色+米白辅，柔和漫射光；温柔回忆：樱粉主色+淡紫辅，朦胧晕染；雨后清新：青绿主色+浅蓝辅，湿润透明感；黄昏静谧：暖橙主色+灰紫辅，低对比柔光。",
    characterRules:
      "线条：淡墨柔边或无硬描边，水彩晕染上色；头身比 6.5-7 头身；肤感：透明水润、留白高光；三视图/定妆照保持同一人物与水彩笔触，浅色纸质背景。",
    sceneRules:
      "柔边晕染表现空间，留白呼吸；水润透明光影；避免硬边与 3D 塑料质感。",
    negative:
      "digital art, harsh lines, 3d render, sharp edges, plastic texture",
  },

  // ========== Toonflow 改编的 5 个完整画风包 ==========
  {
    id: "anime90s",
    label: "90年代日漫",
    description: "复古日式动画，手绘平涂、怀旧治愈暖调",
    anchor:
      "90s anime aesthetic, retro Japanese animation, hand-drawn cel painting, smooth flowing linework, warm nostalgic palette, cinematic soft shadows",
    colorSystem:
      "L1 硬约束：肤色暖黄基底 #F5E6D0，发色/瞳色深棕 #4A3728（允许深褐微移），主服低饱和。L2 软约束：场景用樱花粉 #F4D5D5/天空蓝 #87AEC9/琥珀暖 #C9A96E/米白 #F5F0E8，随镜头微调。L3 例外：回忆/黄昏/高潮可用更暖更高饱和局部色块，但保留整体暖调。色温偏暖 4800-5200K，饱和度中低 50-70%，禁高饱和荧光色。",
    moodPalettes:
      "日常温馨：暖黄主色+米白/高级灰辅，柔和均匀暖光；心动瞬间：樱花粉主色+暖黄/暖橙辅，肤色微红；黄昏浪漫：琥珀暖主色+暖橙/樱花粉辅，逆光轮廓光；夜晚月色：天空蓝主色+淡紫/暖黄辅，冷调暖点缀；回忆闪回：暖黄主色+淡紫/高级灰辅，柔焦雾化轻微褪色。",
    characterRules:
      "线条：精细流畅手绘描边、无数字锐利边缘，平涂块面阴影；头身比女 6-6.5 头身、男 6.5-7.5 头身（90年代比例）；肤感：冷白/暖调米白、平涂柔和光泽、手绘质感；三视图/定妆照素颜无妆、无发饰，暖调米白背景 #F8F4E8。",
    sceneRules:
      "前/中/后景纵深必备，室外含空气透视远景偏灰；清晰线条+块面阴影，材质带自然使用痕迹（拒 CG 全新感）；柔和电影暖光、自然光照。",
    negative:
      "modern anime, Makoto Shinkai style, 3d render, cg, neon fluorescent colors, harsh contrast, modern buildings",
  },
  {
    id: "guofeng2d",
    label: "2D国风",
    description: "国风二次元新国潮，赛璐璐平涂+东方古韵",
    anchor:
      "Chinese guofeng anime, neo-chinoiserie, cel-shaded flat coloring with Japanese-style rendering, oriental elegance, cinematic composition, ink-outline linework",
    colorSystem:
      "L1 硬约束：中国传统色基线，线条墨黑或深棕（禁纯黑粗线），阴影同色系加深（禁黑色硬阴影），赛璐璐色块平滑无断层。L2 软约束：服饰/场景用月白 #E8EAF5/青绿 #4A9B8A/朱红 #C93752/靛蓝 #2B4C7E/金黄 #D4AF37 点缀，随情绪微调。L3 例外：高光时刻可局部突破。色温中性 5000-5600K，饱和度中高 55-70%，禁高饱和荧光色。",
    moodPalettes:
      "仙侠飘逸：月白+青绿主色，金黄/胭脂辅，柔和飘逸光；宫廷华贵：朱红+金黄主色，月白/墨黑辅，暖光高光景深；武侠对决：墨黑+靛蓝主色，青绿/赭石辅，冷调硬光紧张；少女日常：胭脂+月白主色，藤黄/灰紫辅，柔和暖光清新；月夜诗意：靛蓝+月白主色，墨黑/金黄点缀，冷月光局部暖光。",
    characterRules:
      "线条：清晰细腻墨色描边、赛璐璐平涂结合日式渲染；二次元古风比例；肤感：胭脂 #A94A5F 腮红唇色、细腻通透；古风服饰精致（汉服形制）；三视图/定妆照保持同一人物与古风服饰，浅色留白背景。",
    sceneRules:
      "东方意境+留白构图，传统建筑细节丰富；诗意光影层次，青绿山水氛围；避免西方奇幻/赛博/现代元素。",
    negative:
      "photorealistic, 3d realistic render, western fantasy, cyberpunk, neon colors, modern clothing, crude linework",
  },
  {
    id: "anime3d",
    label: "3D动画渲染",
    description: "赛璐珞质感3D渲染，清晰轮廓、温暖治愈",
    anchor:
      "3D animation rendering, cel-look toon shading, clean crisp contour lines, high-detail materials, cinematic soft lighting, warm healing atmosphere, Pixar-adjacent stylization",
    colorSystem:
      "L1 硬约束：肤色暖橙基底 #F5A673，发色/瞳色深棕 #4A3728（允许深褐微移），主服底色明快。L2 软约束：场景用天空蓝 #87AEC9/琥珀暖 #C9A96E/薄荷绿 #9DC2A5/米白 #F5F0E8，随镜头微调。L3 例外：浪漫/黄昏/高潮可用更暖更高饱和局部色块。色温偏暖 4800-5200K，饱和度中高 65-80%，明快温暖，禁高饱和荧光色与暗调重阴影。",
    moodPalettes:
      "日常温馨：暖黄主色+米白/高级灰辅，柔和均匀暖光；心动瞬间：樱花粉主色+暖橙/暖黄辅，肤色微红提亮；黄昏浪漫：琥珀暖主色+暖橙/樱花粉辅，逆光霞光轮廓光；夜晚街景：天空蓝主色+淡紫/暖橙辅，冷调暖点缀；室内日常：暖黄主色+米白/高级灰辅，暖光柔焦温馨。",
    characterRules:
      "线条：清晰轮廓描边+高细节材质，写实材质与卡通比例结合；头身比 6.5-7.5 头身；肤感：暖橙通透、次表面柔光、无写实毛孔；发丝清晰轮廓+自然光影层次；三视图/定妆照保持同一人物与 3D 质感，中性灰背景，勿转 2D 平涂。",
    sceneRules:
      "现代都市空间（街道/咖啡厅/居家/办公室），空间层次丰富、材质细腻；电影级柔光氛围、明快温暖；避免暗调重阴影与写实照片感。",
    negative:
      "photorealistic, real photo, dark low-key, heavy shadows, harsh contrast, neon fluorescent colors, flat 2d cel anime",
  },
  {
    id: "guofeng-cyber",
    label: "3D国风赛博",
    description: "东方美学融合赛博科幻，次世代3D渲染",
    anchor:
      "guofeng cyberpunk 3D render, next-gen PBR materials, oriental aesthetics fused with sci-fi, ink-wash volumetric light, hanfu-meets-mecha, cinematic ray-traced lighting, holographic motifs",
    colorSystem:
      "L1 硬约束：以青绿/朱红/靛蓝/鎏金/墨黑为基底，低饱和中式霓虹（朱砂红霓虹、石青蓝全息、鎏金辉光），杜绝荧光溢色。L2 软约束：全息投影纹样/机械发饰点缀，随镜头微调。L3 例外：法阵/高潮镜头可局部提亮全息光。色彩典雅与未来感兼具，PBR 材质质感真实，避免高溢色/强数码噪点/灰蒙低对比。",
    moodPalettes:
      "宫廷皇城：鎏金+朱红主色，全息盘龙辅，体积光穿云史诗感；江南水乡：青绿+墨黑主色，中式霓虹招牌辅，烟雨朦胧水墨光；仙侠秘境：靛蓝+月白主色，全息云海辅，流光萦绕虚实相生；侠女雨夜：墨黑+朱砂红主色，霓虹反光辅，雨水湿发冷硬光；祭司神殿：靛蓝渐变主色，银线星象/朱砂光纹辅，体积光穿透仙气。",
    characterRules:
      "线条：3D 次世代高精度建模、东方古典骨相；完美人体比例、五官精致立体（丹凤眼/桃花眼）；肤感：细腻通透+赛博光效面纹；汉服形制+机能改造、鎏金机械发饰；三视图/定妆照保持同一人物与国风赛博造型，中性背景，织物发丝纤毫毕现。",
    sceneRules:
      "中式飞檐斗拱古建筑+全息霓虹，榫卯摩天楼宇；烟雨水墨意境+赛博光影层次，留白对称构图；体积光穿透雨雾、全局光照，避免无国风内核的纯西方赛博。",
    negative:
      "western cyberpunk without oriental elements, gothic, victorian, photorealistic real photo, low-poly, oversaturated neon bleed, deformed anatomy, modern city daily elements",
  },
  {
    id: "urban2d",
    label: "2D都市情感",
    description: "成熟都市言情二次元，冷调高级灰、戏剧化光影",
    anchor:
      "mature urban romance anime, modern novel-adaptation style, cel shading with clean lines, cinematic low-key dramatic lighting, cool desaturated high-grade palette, shallow depth of field",
    colorSystem:
      "L1 硬约束：女性肤色冷白 #F5EDE8、男性肤色暖白 #F5E6D8，发色/瞳色墨黑 #1A1A2E（允许暗蓝/冷棕微移）。L2 软约束：环境用浅蓝 #B8D4E3/青灰 #7A8B99/琥珀暖 #C9A96E/银灰 #C0C7CE，随情绪微调。L3 例外：节庆/回忆/高潮可局部提暖提饱和（禁霓虹）。色温偏冷 5800-7000K，饱和度中低 30-50%（高级灰调），对比度强。",
    moodPalettes:
      "初见心动：冷白肤主色+烟霞粉/银灰辅，冷基底局部柔暖高光；暧昧升温：烟霞粉主色+琥珀暖/素白辅，中近景提暖软焦；守护承诺：素白主色+浅蓝/墨黑辅，明暗清晰仪式感；分离误会：青灰主色+冷白/中性灰辅，降饱和拉大冷暖反差；重逢释怀：冷白肤主色+琥珀暖/烟霞粉辅，先冷后暖面部暖光。",
    characterRules:
      "线条：清晰赛璐璐上色、面容细腻渲染；现代都市二次元比例；肤感：冷白/暖白通透、皮肤细腻、纹理超清晰；发丝层次分明；三视图/定妆照保持同一人物与现代都市造型，中性灰背景 #E8E8E8，避免暴露/透视。",
    sceneRules:
      "现代都市空间（公寓/办公室/咖啡厅/街道），景深虚化+镜头光学特征+空气透视；戏剧化低调光影、冷调暖点；避免古风/奇幻/科幻元素。",
    negative:
      "photorealistic, real photo, 3d cgi render, neon fluorescent colors, ancient guofeng, fantasy, modern phone screens on frame, nudity, revealing",
  },

  // ========== 旧平面 fallback 风格（仅查表兜底，无完整包内容） ==========
  {
    id: "oil",
    label: "油画风格",
    description: "古典油画，厚涂笔触、丰富质感",
    anchor: "oil painting style, rich textures, classical composition",
    colorSystem: "",
    moodPalettes: "",
    characterRules: "",
    sceneRules: "",
    negative: "digital art, flat shading, anime",
    legacy: true,
  },
  {
    id: "sketch",
    label: "素描风格",
    description: "铅笔素描，线稿细腻、艺术阴影",
    anchor: "pencil sketch style, detailed linework, artistic shading",
    colorSystem: "",
    moodPalettes: "",
    characterRules: "",
    sceneRules: "",
    negative: "color, 3d, shaded rendering, painted",
    legacy: true,
  },
  {
    id: "3d",
    label: "3D 渲染",
    description: "3D 渲染，平滑表面、体积光",
    anchor: "3D rendered, Pixar style, smooth surfaces, volumetric lighting",
    colorSystem: "",
    moodPalettes: "",
    characterRules: "",
    sceneRules: "",
    negative: "flat illustration, 2d anime, cel shaded",
    legacy: true,
  },
  {
    id: "cyberpunk",
    label: "赛博朋克",
    description: "赛博朋克，霓虹灯光、未来高对比",
    anchor: "cyberpunk style, neon lights, futuristic, high contrast",
    colorSystem: "",
    moodPalettes: "",
    characterRules: "",
    sceneRules: "",
    negative: "medieval, fantasy village, rustic",
    legacy: true,
  },
  {
    id: "fantasy",
    label: "奇幻风格",
    description: "奇幻艺术，魔法氛围、空灵光效",
    anchor: "fantasy art style, magical atmosphere, ethereal lighting",
    colorSystem: "",
    moodPalettes: "",
    characterRules: "",
    sceneRules: "",
    negative: "modern technology, cars, skyscrapers",
    legacy: true,
  },
] as const;

/** id → 画风包索引（模块加载时构建一次） */
const PACK_BY_ID: ReadonlyMap<string, StylePack> = new Map(
  STYLE_PACKS.map((pack) => [pack.id, pack])
);

/** 默认画风（未知 id / 空值回落） */
const DEFAULT_PACK_ID = "anime";

/**
 * 取画风包。未知 id / 空值回落到日漫（anime），保证任何历史 style 值都能解析。
 */
export function getStylePack(style?: string | null): StylePack {
  const pack = style ? PACK_BY_ID.get(style) : undefined;
  return pack ?? PACK_BY_ID.get(DEFAULT_PACK_ID)!;
}

/**
 * 画风色彩基线：画风包的分层色彩系统 + 情绪色盘拼成一段紧凑文本，
 * 作为 color script（色彩指定）缺失时的「风格基线参考」——让 Observer 色调门禁
 * 与每镜色彩在画风调性内评判/派生，而非自由发挥。
 * legacy 平面风格（colorSystem/moodPalettes 为空）返回空串，调用方按无基线处理。
 */
export function getStylePaletteBaseline(style?: string | null): string {
  const pack = getStylePack(style);
  return [pack.colorSystem, pack.moodPalettes]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

/** UI 下拉选项（id/label/description），顺序同注册表。 */
export interface StylePackOption {
  value: string;
  label: string;
  description: string;
}

/** 供 UI 消费的画风选项列表（从注册表派生，单一真源）。 */
export const STYLE_PACK_OPTIONS: readonly StylePackOption[] = STYLE_PACKS.map(
  (pack) => ({
    value: pack.id,
    label: pack.label,
    description: pack.description,
  })
);
