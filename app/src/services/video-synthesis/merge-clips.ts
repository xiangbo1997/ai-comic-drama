import path from "path";
import { runFFmpeg } from "./ffmpeg-run";

interface MergeClip {
  path: string;
  effectiveDuration: number;
  startIndex: number;
}

// 长 xfade 链会同时缓存所有输入，限制线程仍不足以阻止多镜头 1080p OOM。
// 分层合并将每次打开的解码器限制为 4 路；累计时长与原始边界索引继续向上传递。
export async function mergeClipsWithTransitions(
  paths: string[],
  durations: number[],
  resolveTransition: (index: number) => { type: string; duration: number },
  outputDir: string,
  crf: string,
  onProgress?: (fraction: number) => void | Promise<void>
): Promise<void> {
  let clips: MergeClip[] = paths.map((clipPath, i) => ({
    path: clipPath,
    effectiveDuration: durations[i],
    startIndex: i,
  }));
  let level = 0;
  let completedTransitions = 0;
  while (clips.length > 1) {
    const next: MergeClip[] = [];
    for (let start = 0; start < clips.length; start += 4) {
      const batch = clips.slice(start, start + 4);
      if (batch.length === 1) {
        next.push(batch[0]);
        continue;
      }
      const filters: string[] = [];
      const args = ["-filter_complex_threads", "1"];
      for (let i = 0; i < batch.length; i++) {
        args.push("-threads", "1", "-i", batch[i].path);
        const pad =
          i < batch.length - 1
            ? resolveTransition(batch[i + 1].startIndex - 1).duration + 0.2
            : 0;
        filters.push(
          pad > 0
            ? `[${i}:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}[vp${i}]`
            : `[${i}:v]null[vp${i}]`
        );
      }
      let previous = "[vp0]";
      let cumulative = batch[0].effectiveDuration;
      for (let i = 1; i < batch.length; i++) {
        const { type, duration } = resolveTransition(batch[i].startIndex - 1);
        const output = i === batch.length - 1 ? "[outv]" : `[vx${i}]`;
        filters.push(
          `${previous}[vp${i}]xfade=transition=${type}:duration=${duration.toFixed(3)}:offset=${Math.max(cumulative - duration, 0).toFixed(3)}${output}`
        );
        previous = output;
        cumulative += batch[i].effectiveDuration - duration;
      }
      const outputPath = path.join(
        outputDir,
        clips.length <= 4 ? "merged.mp4" : `merge_${level}_${start}.mp4`
      );
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[outv]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        crf,
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-y",
        outputPath
      );
      await runFFmpeg(args);
      completedTransitions += batch.length - 1;
      // 每批合成完成就写进度，刷新任务 updatedAt，避免长合成被当作僵尸任务。
      await onProgress?.(completedTransitions / (paths.length - 1));
      next.push({
        path: outputPath,
        effectiveDuration: cumulative,
        startIndex: batch[0].startIndex,
      });
    }
    clips = next;
    level++;
  }
}
