import { describe, expect, it } from "vitest";
import {
  ScriptZ,
  MetricZ,
  PublicationPayloadZ,
} from "@/lib/short-video/contracts";
import { stableHash } from "@/lib/short-video/hash";
import { canonicalSource, platformPostUrl } from "@/lib/short-video/source";
import { canAccessShortVideo } from "@/lib/short-video/config";
import { publicationTransition, dueStatus } from "@/lib/short-video/state";

import { script } from "../fixtures/short-video";
describe("short video contracts", () => {
  it("checks duration, unique shot keys and character references", () => {
    expect(ScriptZ.safeParse(script).success).toBe(true);
    expect(
      ScriptZ.safeParse({ ...script, targetDurationSec: 20 }).success
    ).toBe(false);
    expect(
      ScriptZ.safeParse({
        ...script,
        shots: [{ ...script.shots[0], characterKeys: ["other"] }],
      }).success
    ).toBe(false);
    expect(
      ScriptZ.safeParse({
        ...script,
        shots: [script.shots[0], script.shots[0]],
        targetDurationSec: 30,
      }).success
    ).toBe(false);
  });
  it("hashes content independent of object insertion order", () => {
    expect(stableHash({ a: 1, b: { x: 2, y: 3 } })).toBe(
      stableHash({ b: { y: 3, x: 2 }, a: 1 })
    );
    expect(stableHash({ a: 2 })).not.toBe(stableHash({ a: 1 }));
  });
  it("deduplicates only known tracking parameters and preserves identity", () => {
    const a = canonicalSource(
      "DOUYIN",
      "https://www.douyin.com/video/123?utm_source=x&modal_id=123",
      "x"
    );
    const b = canonicalSource(
      "DOUYIN",
      "https://www.douyin.com/video/123?modal_id=123",
      "x"
    );
    expect(a.canonicalKey).toBe(b.canonicalKey);
    expect(a.canonicalUrl).toContain("modal_id=123");
    expect(
      canonicalSource("DOUYIN", "https://v.douyin.com/a/", "x").canonicalKey
    ).not.toBe(
      canonicalSource("DOUYIN", "https://v.douyin.com/b/", "x").canonicalKey
    );
  });
  it.each([
    "http://127.0.0.1/x",
    "https://169.254.169.254/x",
    "file:///etc/passwd",
    "https://user:pass@www.douyin.com/x",
    "https://www.douyin.com.evil.test/x",
  ])("rejects unsafe import %s", (url) => {
    expect(() => canonicalSource("DOUYIN", url, "x")).toThrow();
  });
  it("does not invent third party links and enforces target platform", () => {
    expect(canonicalSource("OTHER", undefined, "自创").canonicalUrl).toBeNull();
    expect(() =>
      platformPostUrl("DOUYIN", "https://www.kuaishou.com/short-video/123")
    ).toThrow();
  });
  it("gates access by feature, role and active account", () => {
    expect(
      canAccessShortVideo({ id: "a", role: "ADMIN", status: "ACTIVE" }, {})
    ).toBe(false);
    expect(
      canAccessShortVideo(
        { id: "a", role: "ADMIN", status: "ACTIVE" },
        { SHORT_VIDEO_ENABLED: "true" }
      )
    ).toBe(true);
    expect(
      canAccessShortVideo(
        { id: "a", role: "USER", status: "ACTIVE" },
        { SHORT_VIDEO_ENABLED: "true", SHORT_VIDEO_ALLOWED_USER_IDS: "a" }
      )
    ).toBe(true);
    expect(
      canAccessShortVideo(
        { id: "a", role: "ADMIN", status: "BANNED" },
        { SHORT_VIDEO_ENABLED: "true" }
      )
    ).toBe(false);
  });
  it("requires approval and treats late schedules as expired", () => {
    expect(publicationTransition("DRAFT", "approve")).toBe("APPROVED");
    expect(() => publicationTransition("DRAFT", "schedule")).toThrow();
    expect(() => publicationTransition("SUBMITTING", "cancel")).toThrow();
    expect(dueStatus(new Date(1000), new Date(700001), "MANUAL", 600)).toBe(
      "EXPIRED"
    );
    expect(dueStatus(new Date(1000), new Date(1000), "MANUAL", 600)).toBe(
      "AWAITING_MANUAL"
    );
    expect(dueStatus(new Date(2000), new Date(1000), "MANUAL", 600)).toBeNull();
  });
  it("preserves unknown metrics as null and rejects impossible rates", () => {
    expect(
      MetricZ.parse({
        observedAt: "2026-11-19T00:00:00Z",
        windowLabel: "H24",
        metrics: {},
      }).metrics.views
    ).toBeNull();
    expect(
      MetricZ.safeParse({
        observedAt: "2026-11-19T00:00:00Z",
        windowLabel: "H24",
        metrics: { completionRate: 1.1 },
      }).success
    ).toBe(false);
    expect(
      PublicationPayloadZ.safeParse({
        title: "x",
        text: "x",
        hashtags: [],
        aiGenerated: true,
        commercial: false,
        token: "secret",
      }).success
    ).toBe(false);
  });
});
