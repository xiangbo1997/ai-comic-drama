import { EventEmitter } from "events";
import { spawn } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFFmpeg } from "@/services/video-synthesis/ffmpeg-run";

vi.mock("child_process", () => ({ spawn: vi.fn() }));

describe("runFFmpeg", () => {
  let child: EventEmitter & { stderr: EventEmitter };
  beforeEach(() => {
    child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    vi.mocked(spawn).mockReturnValue(
      child as unknown as ReturnType<typeof spawn>
    );
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
