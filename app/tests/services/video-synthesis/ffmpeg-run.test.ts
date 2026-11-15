import { EventEmitter } from "events";
import { spawn } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFFmpeg } from "@/services/video-synthesis/ffmpeg-run";

vi.mock("child_process", () => ({ spawn: vi.fn() }));

describe("runFFmpeg", () => {
  let child: EventEmitter & { stderr: EventEmitter };
  beforeEach(() => {
    vi.clearAllMocks();
    child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    vi.mocked(spawn).mockReturnValue(
      child as unknown as ReturnType<typeof spawn>
    );
  });

  it("不同导出的 FFmpeg 共用单路队列，前一个结束后才启动下一个", async () => {
    const second = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });
    vi.mocked(spawn)
      .mockReturnValueOnce(child as never)
      .mockReturnValueOnce(second as never);
    const firstRun = runFFmpeg(["-i", "first.mp4", "first-out.mp4"]);
    const secondRun = runFFmpeg(["-i", "second.mp4", "second-out.mp4"]);
    expect(spawn).toHaveBeenCalledTimes(1);
    child.emit("close", 0, null);
    await firstRun;
    expect(spawn).toHaveBeenCalledTimes(2);
    second.emit("close", 0, null);
    await secondRun;
  });

  it("进程失败也释放队列，error 后 close 不会重复启动后续任务", async () => {
    const second = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });
    const third = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
    });
    vi.mocked(spawn)
      .mockReturnValueOnce(child as never)
      .mockReturnValueOnce(second as never)
      .mockReturnValueOnce(third as never);
    const firstRun = expect(runFFmpeg([])).rejects.toThrow("spawn ENOENT");
    const secondRun = runFFmpeg([]);
    const thirdRun = runFFmpeg([]);
    child.emit("error", new Error("spawn ENOENT"));
    child.emit("close", -2, null);
    await firstRun;
    expect(spawn).toHaveBeenCalledTimes(2);
    second.emit("close", 0, null);
    await secondRun;
    expect(spawn).toHaveBeenCalledTimes(3);
    third.emit("close", 0, null);
    await thirdRun;
  });

  it("每路输入和滤镜默认单线程、编码双线程，保持原始输入参数不变", async () => {
    const args = [
      "-loop",
      "1",
      "-i",
      "first.jpg",
      "-i",
      "voice.mp3",
      "-vf",
      "scale=1080:1920",
      "-y",
      "out.mp4",
    ];
    const original = [...args];
    const result = runFFmpeg(args);
    const passed = vi.mocked(spawn).mock.calls[0][1] as string[];
    for (let i = 0; i < passed.length; i++) {
      if (passed[i] === "-i")
        expect(passed.slice(i - 2, i)).toEqual(["-threads", "1"]);
    }
    expect(passed[passed.indexOf("-filter_threads") + 1]).toBe("1");
    expect(passed[passed.indexOf("-filter_complex_threads") + 1]).toBe("1");
    expect(passed.slice(-3)).toEqual(["-threads", "2", "out.mp4"]);
    expect(args).toEqual(original);
    child.emit("close", 0, null);
    await result;
  });

  it("保留已显式限定的输入、滤镜及编码线程", async () => {
    const args = [
      "-threads",
      "1",
      "-i",
      "in.mp4",
      "-filter_complex_threads",
      "1",
      "-threads",
      "2",
      "out.mp4",
    ];
    const result = runFFmpeg(args);
    const passed = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(passed.filter((value) => value === "-threads")).toHaveLength(2);
    expect(
      passed.filter((value) => value === "-filter_complex_threads")
    ).toHaveLength(1);
    child.emit("close", 0, null);
    await result;
  });

  it("报告 SIGKILL，避免只留下 code null", async () => {
    const result = runFFmpeg(["-version"]);
    const assertion = expect(result).rejects.toThrow(
      "FFmpeg terminated by signal SIGKILL"
    );
    child.stderr.emit("data", Buffer.from("diagnostic output"));
    child.emit("close", null, "SIGKILL");
    await assertion;
  });

  it("正常退出成功", async () => {
    const result = runFFmpeg(["-version"]);
    child.emit("close", 0, null);
    await expect(result).resolves.toBeUndefined();
  });

  it("保留非零退出码和 stderr", async () => {
    const result = runFFmpeg([]);
    child.stderr.emit("data", Buffer.from("bad filter"));
    child.emit("close", 1, null);
    await expect(result).rejects.toThrow(
      "FFmpeg exited with code 1: bad filter"
    );
  });

  it("透传进程启动失败", async () => {
    const result = runFFmpeg([]);
    child.emit("error", new Error("spawn ENOENT"));
    await expect(result).rejects.toThrow("spawn ENOENT");
  });
});
