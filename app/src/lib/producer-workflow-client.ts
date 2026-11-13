import { draftWorldview, draftCharacterRoster } from "@/lib/assist-client";
import {
  advanceProducerRun,
  createAndLinkCharacter,
  createProducerDraftFinalizer,
  getProducerRun,
  runDramaScript,
} from "@/lib/producer-client";
import { extractProducerCharacterNames } from "@/lib/producer-character-extract";
import {
  PRODUCER_STEPS,
  type ProducerRunSnapshot,
  type ProducerStep,
} from "@/lib/producer-run";

/** 每次恢复都从服务端checkpoint推进；浏览器状态仅用于展示，不能跳过已保存校验。 */
export async function continueProducerRun(
  id: string,
  onSnapshot: (snapshot: ProducerRunSnapshot) => void,
  onStep: (step: ProducerStep) => void,
  isStopped: () => boolean = () => false
): Promise<ProducerRunSnapshot> {
  const token = crypto.randomUUID();
  let current = await advanceProducerRun(id, { action: "claim", token });
  onSnapshot(current);
  if (current.status === "completed") return current;
  let heartbeatError: Error | null = null;
  let heartbeatPending = false;
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    void advanceProducerRun(id, { action: "heartbeat", token })
      .catch((error) => {
        heartbeatError =
          error instanceof Error ? error : new Error("制作会话失效");
      })
      .finally(() => {
        heartbeatPending = false;
      });
  }, 20000);
  const check = () => {
    if (isStopped()) throw new Error("制作已暂停，可重新打开向导继续");
    if (heartbeatError) throw heartbeatError;
  };
  const save = async (action: Parameters<typeof advanceProducerRun>[1]) => {
    check();
    current = await advanceProducerRun(id, action);
    onSnapshot(current);
  };
  try {
    for (const step of PRODUCER_STEPS) {
      check();
      if (current.completedSteps.includes(step)) continue;
      onStep(step);
      const settings = current.settings;
      if (step === "worldview") {
        const draft = await draftWorldview({
          idea: settings.idea,
          ...(settings.genre ? { genre: settings.genre } : {}),
        });
        await save({ action: "worldview", token, draft });
      } else if (step === "project") {
        await save({ action: "project", token });
      } else if (step === "script") {
        if (!current.projectId || !current.worldviewDraft)
          throw new Error("项目或世界观缺失");
        const result = await runDramaScript(current.projectId, {
          worldview: current.worldviewDraft.worldview,
          protagonist: current.worldviewDraft.protagonist,
          durationSec: settings.durationSec,
          aspectRatio: settings.aspectRatio,
          style: settings.style,
          ...(settings.genre ? { genre: settings.genre } : {}),
        });
        await save({ action: "script", token, scriptId: result.scriptId });
      } else if (step === "characters") {
        if (!current.projectId || !current.artifact)
          throw new Error("脚本状态缺失");
        const names = extractProducerCharacterNames(current.artifact);
        if (!current.roster) {
          let roster: NonNullable<ProducerRunSnapshot["roster"]> = [];
          try {
            const result = await draftCharacterRoster({
              names,
              worldview: current.artifact.worldview,
              protagonist: current.artifact.protagonist,
              scenesDigest: current.artifact.scenes
                .map((s) => `${s.title}：${s.description}\n${s.dialogue ?? ""}`)
                .join("\n"),
            });
            roster = result.characters;
          } catch {
            /* 画像服务不可用时保存降级状态，不影响已建档资源。 */
          }
          await save({ action: "roster", token, roster });
        }
        for (const name of names) {
          check();
          if (current.createdCharNames.includes(name)) continue;
          await createAndLinkCharacter(
            current.projectId!,
            name,
            current.roster?.find((item) => item.name === name)
          );
          await save({ action: "character", token, name });
        }
        await save({ action: "characters", token });
      } else {
        if (!current.projectId || !current.artifact)
          throw new Error("脚本状态缺失");
        await createProducerDraftFinalizer()(
          current.projectId,
          current.artifact,
          extractProducerCharacterNames(current.artifact),
          settings.genre || null,
          { runId: id, token }
        );
        current = await getProducerRun(id);
        onSnapshot(current);
      }
    }
    return current;
  } catch (error) {
    const message = error instanceof Error ? error.message : "制作中断";
    try {
      current = await advanceProducerRun(id, {
        action: "release",
        token,
        error: message.slice(0, 500),
      });
      onSnapshot(current);
    } catch {
      /* 网络断开或租约已移交时，不覆盖新持有者状态。 */
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (current.status === "completed")
      await advanceProducerRun(id, { action: "release", token }).catch(
        () => {}
      );
  }
}
