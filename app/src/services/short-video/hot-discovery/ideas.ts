import { stableHash } from "@/lib/short-video/hash";
import {
  HotReportZ,
  type HotBoard,
  type HotIdea,
  type HotInput,
  type HotReport,
  type HotTopic,
} from "@/lib/short-video/hot-discovery";
import { freshTopic } from "./sources";
const names = { DOUYIN: "抖音", KUAISHOU: "快手", XIAOHONGSHU: "小红书" };
function category(title: string): HotIdea["category"] | null {
  // 优先适合原创日常反差的小题材；不把真实灾难、案件和新闻人物套成搞笑剧本。
  if (
    /APEC|领导人|伪史|外交部|总统|证监会|会晤|死亡|遇难|地震|车祸|犯罪|遇害|自杀|爆炸|元首|特朗普|外交|普京|基金|股市|总理|战争|遗体|去世/.test(
      title
    )
  )
    return null;
  if (/慌啥|慢慢来|松弛|不着急|躺平|休息|摆烂/.test(title)) return "RELAX";
  if (/猫|狗|水豚|动物|熊猫|兔|羊|鹦鹉|宠物|仓鼠/.test(title)) return "ANIMAL";
  if (
    /吃|饭|火锅|红薯|奶茶|辣|面|卤|虾|蛋糕|美食|烧烤|番茄|棒棒糖|鸡骨草|摆摊/.test(
      title
    )
  )
    return "FOOD";
  if (/打工|上班|下班|会议|加班|老板|周一|周五|周末|工资/.test(title))
    return "WORK";
  if (
    /反差|抽象|离谱|搞笑|普通|日常|训练|早八|起床|懒|学习|考试|闹钟/.test(title)
  )
    return "DAILY";
  return null;
}
function draft(
  topic: HotTopic,
  kind: HotIdea["category"],
  style: HotInput["style"]
): HotIdea {
  const fantasy = style === "XIANXIA";
  const animal = style === "ANIMALS";
  const lead = fantasy ? "松弛掌门" : animal ? "水豚同事" : "淡定打工人";
  const other = fantasy ? "雷公" : animal ? "仓鼠主管" : "闹钟管理员";
  const concepts = {
    RELAX: {
      title: fantasy ? "全宗门最松弛的人去渡劫了" : "截止时间决定等我吃完",
      premise: "把最紧急的催促变成一场耐心排队",
      first: `${lead}坐在塑料凳上端着泡面，头顶${fantasy ? "雷云压顶" : "巨大倒计时"}，画面中只有凳子和面碗两个道具`,
      action1: "主角低头嗦一口面",
      line1: "别慌，先把饭吃好。",
      second: `${other}蹲在主角旁边拿着号码牌，${fantasy ? "闪电被卷成了等候区的栏杆" : "倒计时牌显示暂停营业"}`,
      action2: "催促者举起等待号码牌",
      line2: "那我等你吃完。",
      ending: "连催促本身也开始排队",
      subtitle1: "倒计时：3秒",
      subtitle2: "紧急事项已加入等候队列",
    },
    ANIMAL: {
      title: fantasy ? "灵兽外卖开始收保护费" : "外卖骑手比我先吃饱",
      premise: "把动物递东西改编成过度负责的配送服务",
      first: `${fantasy ? "原创橘猫灵兽" : "原创橘猫骑手"}伸爪递出一只烤红薯，身后停着小电瓶车`,
      action1: "橘猫把红薯递到画面前",
      line1: "您的外卖，请查收。",
      second: "镜头拉远，橘猫坐在小电瓶车上，另一只爪子拿着少了一半的红薯",
      action2: "橘猫低头咬一口自己手里的红薯",
      line2: "我已试吃，品质稳定。",
      ending: "配送服务自带试吃员",
      subtitle1: "骑手已到达",
      subtitle2: "品质检测消耗：50%",
    },
    FOOD: {
      title: fantasy ? "火系长老申请转系" : "嘴硬的人先点了冰粉",
      premise: "把逞强吃辣变成身份当场变更",
      first: `${fantasy ? "火系长老" : "自称不怕辣的原创食客"}站在小火锅前，胸前挂着写字挂牌`,
      action1: "主角自信地夹起一口辣锅食物",
      line1: "我这体质，还能怕这点辣？",
      second: "同一主角抱着一碗冰粉，把胸前挂牌翻到另一面",
      action2: "主角把挂牌翻过来",
      line2: fantasy ? "从今天起，我是水系实习生。" : "从今天起，我负责清汤。",
      ending: "身份可以嘴硬，身体选择清汤",
      subtitle1: "挑战开始",
      subtitle2: fantasy ? "转系申请：秒批" : "清汤组已接收申请",
    },
    WORK: {
      title: fantasy ? "宗门考勤把天雷也算进去了" : "打卡机申请先下班",
      premise: "让本来负责催人的工具也有下班诉求",
      first: `${lead}走到${fantasy ? "宗门门口的灵石考勤牌" : "办公室门口的打卡机"}前，旁边挂着加班通知`,
      action1: "主角伸手准备打卡",
      line1: "今天几点能走？",
      second: "考勤工具长出两条小腿，背着一个小包，指向还在原地站着的主角",
      action2: "考勤工具迈出一步",
      line2: "我先下班，你替我盯一下。",
      ending: "工具先获得了下班自由",
      subtitle1: "等待下班中",
      subtitle2: "设备已离线，员工请继续在线",
    },
    DAILY: {
      title: fantasy ? "闭关三年只练会了关闹钟" : "训练成果：闹钟先投降",
      premise: "把日常训练夸张成连工具都承受不住的技能",
      first: `${lead}盘腿坐在一张普通床上，身旁只有一个闹钟和一张练功表`,
      action1: "主角闭眼伸手按向闹钟",
      line1: "严苛的训练，不能白练。",
      second: "闹钟自己举起白旗，屏幕显示申请调休，主角仍保持盘腿姿势",
      action2: "闹钟缓慢举起白旗",
      line2: "你没醒，我已经累了。",
      ending: "训练成果只对闹钟生效",
      subtitle1: "训练第100天",
      subtitle2: "闹钟申请带薪休眠",
    },
  };
  const c = { ...concepts[kind] };
  if (kind === "ANIMAL" && /羊/.test(topic.title)) {
    c.title = fantasy ? "灵羊送来的麦穗有点少" : "快递员把包装也吃了";
    c.first = "原创小羊骑手伸出蹄子递来一束麦穗，身后停着小电瓶车";
    c.action1 = "小羊把麦穗递到画面前";
    c.line1 = "您的快递，请查收。";
    c.second = "镜头拉远，小羊正在嚼着一截麦秆，递出去的麦穗只剩标签";
    c.action2 = "小羊慢慢嚼一口麦秆";
    c.line2 = "我只拆了可食用包装。";
  }
  if (kind === "FOOD" && !/辣|火锅|卤/.test(topic.title)) {
    const dish = /鸡骨草/.test(topic.title)
      ? "鸡骨草茶"
      : /番茄/.test(topic.title)
        ? "小番茄"
        : /糖/.test(topic.title)
          ? "棒棒糖"
          : "牛肉面";
    c.title = `刚端上来的${dish}开始打卡`;
    c.first = `${lead}坐在餐桌前，桌上只有一份${dish}和一个小打卡牌`;
    c.action1 = "主角把餐具拿起来";
    c.line1 = "今天就简单吃点。";
    c.second = `${dish}长出两只小手，举起写着已下班的小牌子，主角愣在桌边`;
    c.action2 = "食物举起小牌子";
    c.line2 = "不好意思，我比你先下班。";
    c.ending = "连晚饭也开始拒绝加班";
    c.subtitle1 = "简单吃点";
    c.subtitle2 = "本餐营业时间已结束";
  }
  const characters = [
    {
      key: "lead",
      name:
        kind === "ANIMAL"
          ? /羊/.test(topic.title)
            ? "原创小羊骑手"
            : "原创橘猫骑手"
          : lead,
      appearance:
        kind === "ANIMAL"
          ? /羊/.test(topic.title)
            ? "原创白色小羊，蓝色配送围裙"
            : "原创橘色小猫，蓝色配送围裙"
          : `${fantasy ? "原创白胡子修士，朴素道袍" : animal ? "原创棕色水豚，蓝色工牌" : "原创普通上班族，蓝色外套"}，同一角色外观保持一致`,
    },
    {
      key: "other",
      name:
        kind === "WORK"
          ? "拟人考勤机"
          : kind === "DAILY"
            ? "拟人闹钟"
            : kind === "FOOD" && !/辣|火锅|卤/.test(topic.title)
              ? "拟人食物"
              : kind === "ANIMAL"
                ? "原创收货人"
                : other,
      appearance: "原创拟人化配角，表情认真，无知名人物或品牌标识",
    },
  ];
  const shots = [
    {
      key: "shot-1",
      durationSec: 10,
      description: c.first,
      imagePrompt: `${c.first}。9:16竖屏，原创${fantasy ? "修仙喜剧" : animal ? "动物职场动画" : "日常荒诞动画"}，清晰角色与道具，文字后期添加`,
      videoPrompt: `${c.action1}，单镜一个主要动作，固定镜头，不生成字幕`,
      dialogue: c.line1,
      narration: "",
      subtitle: c.subtitle1,
      characterKeys: ["lead"],
    },
    {
      key: "shot-2",
      durationSec: 10,
      description: c.second,
      imagePrompt: `${c.second}。沿用上一镜的角色服装与道具，竖屏原创动画，文字后期添加`,
      videoPrompt: `${c.action2}，单镜一个主要动作，保持角色外观，不生成字幕`,
      dialogue: c.line2,
      narration: "",
      subtitle: c.subtitle2,
      characterKeys: ["lead", "other"],
    },
  ];
  return {
    id: stableHash({ topicId: topic.id, style }).slice(0, 32),
    topicId: topic.id,
    title: c.title,
    category: kind,
    outline: `创作联想：${c.first}。${c.action1}：“${c.line1}”第二镜，${c.second}：“${c.line2}”`,
    rationale:
      "标题能引出一句话反差，两个镜头、少量道具，每镜一个动作，适合先做短片验证。仅为原创联想，不是对来源视频剧情的复述。",
    firstFrame: c.first,
    difficulty: "低",
    durationSec: 20,
    script: {
      schemaVersion: 1,
      title: c.title,
      hook: c.subtitle1,
      premise: c.premise,
      targetDurationSec: 20,
      aspectRatio: "9:16",
      characters,
      shots,
      ending: c.ending,
      suggestedCaption: c.title,
      hashtags: ["原创动画", "抽象日常"],
    },
  };
}
export function buildHotBrief(
  input: HotInput,
  sources: HotBoard[],
  now = new Date()
): HotReport {
  const topics = sources.flatMap((s) => s.items);
  const seen = new Set<string>();
  const usedCategories = new Set<string>();
  const wanted = /只.*猫|关于猫|猫咪|小猫/.test(input.query)
    ? /猫/
    : /只.*狗|关于狗|狗狗/.test(input.query)
      ? /狗/
      : null;
  const candidates = topics
    .flatMap((t) => {
      const kind = category(t.title);
      const requested = /美食|吃饭|食物/.test(input.query)
        ? "FOOD"
        : /职场|打工|上班/.test(input.query)
          ? "WORK"
          : /动物|宠物/.test(input.query)
            ? "ANIMAL"
            : null;
      if (requested && kind !== requested) return [];
      if (
        !kind ||
        !freshTopic(t, now, input.windowDays) ||
        (wanted && !wanted.test(t.title))
      )
        return [];
      return [
        {
          topic: t,
          kind,
          score:
            (kind === "RELAX"
              ? 100
              : kind === "ANIMAL"
                ? 90
                : kind === "FOOD"
                  ? 85
                  : 60) +
            (t.evidenceKind === "PUBLIC_BOARD" ? 5 : 0) -
            (t.rank ?? 100) / 100,
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
  const ideas = candidates
    .flatMap(({ topic, kind }) => {
      const key = topic.title.replace(/[\s\p{P}]/gu, "");
      if (seen.has(key) || usedCategories.has(kind)) return [];
      usedCategories.add(kind);
      seen.add(key);
      return [draft(topic, kind, input.style)];
    })
    .slice(0, 8);
  const available = sources
    .filter((s) => s.items.some((t) => freshTopic(t, now, input.windowDays)))
    .map((s) => names[s.platform]);
  const missing = sources
    .filter(
      (s) =>
        s.status !== "AVAILABLE" ||
        !s.items.some((t) => freshTopic(t, now, input.windowDays))
    )
    .map((s) => names[s.platform]);
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);
  let summary = `检索时间：${date}（北京时间）。${available.length ? `取得${available.join("、")}的公开榜单快照，` : "未取得足够新鲜的榜单证据，"}按最近${input.windowDays}天的来源更新时间筛选。`;
  if (ideas[0])
    summary += `如果先做一条，我选「${topics.find((t) => t.id === ideas[0].topicId)!.title}」，改编为《${ideas[0].title}》。`;
  else
    summary +=
      "未取得足够证据支持新的抽象选题推荐；可调整关键词或手动导入，不使用历史示例补数。";
  if (missing.length)
    summary += `${missing.join("、")}未取得完整可验证的近期热点，见逐平台状态。`;
  return HotReportZ.parse({
    schemaVersion: 1,
    query: input.query,
    style: input.style,
    generatedAt: now.toISOString(),
    summary,
    sources,
    topics,
    ideas,
    recommendation: ideas[0]?.id ?? null,
    notes: [
      "采集时间与来源更新时间分别展示；话题首次出现时间、作品发布时间和播放量未知时不补写。",
      "公开热搜和第三方榜单不等于官方授权搜索接口，搜索结果顺序不冒充平台热度排名。",
      "改编为无需付费模型的结构化原创草案；预览并编辑后再保存脚本，不自动调用模型、生成视频或发布。",
      "只有来源更新时间在所选范围内的话题参与推荐；无日期的网页候选可供核对，不称为最新热梗。",
    ],
  });
}
