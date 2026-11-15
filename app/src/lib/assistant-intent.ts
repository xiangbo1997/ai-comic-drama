export interface AssistantIntent {
  bgmOnly: boolean;
  allowBgmWrite: boolean;
  allowBgmReplace: boolean;
  allowBgmDisable: boolean;
}

/** 仅使用真实用户消息判定当前目标；模型建议和项目资料不能扩大操作范围。 */
export function resolveAssistantIntent(
  content: string,
  history: Array<{ role: string; content: string }> = []
): AssistantIntent {
  const budgetReply =
    /^(?:(?:预算|上限|最多|不超过|积分上限)\s*)?\d+\s*(?:积分|点)?[。！!]?$/;
  const followup = (text: string) =>
    budgetReply.test(text.trim()) ||
    /^(?:没有上限|不限|无限)[。！!]?$/u.test(text.trim());
  const effective = followup(content)
    ? ([...history]
        .reverse()
        .find(
          (message) => message.role === "user" && !followup(message.content)
        )?.content ?? content)
    : content;
  const hasBgm = /背景音乐|背景音樂|配乐|配樂|\bbgm\b|background\s+music/i.test(
    effective
  );
  const positive = effective.replace(
    /(?:不要|不用|无需|不需要|别|不必|先不|暂不|不(?=替换|更换|换|重选|覆盖|关闭))[^，。；;！？!?,\n]*/gu,
    ""
  );
  const hasVisualWork =
    /(?:生成|补齐|制作|重做|修复|重绘|更新|create|generate)[^，。；;！？!?\n]{0,15}(?:图像|图片|视频|画面|分镜|参考图|成片|image|video)/i.test(
      positive
    );
  const inquiry = /怎么|如何|哪个好|建议|推荐|区别|what|how\b/i.test(effective);
  const negated = /\b(?:do\s+not|don['’]?t|never)\b/i.test(effective);
  const positiveBgm =
    /背景音乐|背景音樂|配乐|配樂|\bbgm\b|background\s+music|音量|闪避|淡入|淡出/i.test(
      positive
    );
  const write =
    hasBgm &&
    positiveBgm &&
    !inquiry &&
    !negated &&
    /加|配上|配乐|设置|配置|选|调|改|换|关|打开|开启|移除|删除|取消|\b(?:add|set|change|remove|disable|enable)\b/i.test(
      positive
    );
  return {
    bgmOnly: hasBgm && !hasVisualWork,
    allowBgmWrite: write,
    allowBgmReplace:
      write &&
      /替换|更换|换|重选|重新选|覆盖|\b(?:replace|change)\b/i.test(positive),
    allowBgmDisable:
      write &&
      /关闭|关掉|去掉|移除|删除|取消|\b(?:remove|disable)\b/i.test(positive),
  };
}
