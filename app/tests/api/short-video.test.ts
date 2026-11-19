import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  user: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.user } },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: mocks.rate },
  rateLimitHeaders: () => ({}),
}));
import {
  shortVideoUser,
  shortVideoError,
  shortVideoBody,
} from "@/lib/short-video/api";
import { SvError } from "@/lib/short-video/errors";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHORT_VIDEO_ENABLED", "true");
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.user.mockResolvedValue({ id: "u1", role: "ADMIN", status: "ACTIVE" });
  mocks.rate.mockResolvedValue({ success: true });
});
describe("short video authenticated API boundary", () => {
  it("refuses unauthenticated/disabled/non-allowed and fresh banned users", async () => {
    const req = new NextRequest(
      "https://example.test/api/short-videos/capabilities"
    );
    mocks.auth.mockResolvedValueOnce(null);
    await expect(shortVideoUser(req)).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("SHORT_VIDEO_ENABLED", "false");
    await expect(shortVideoUser(req)).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("SHORT_VIDEO_ENABLED", "true");
    mocks.user.mockResolvedValueOnce({
      id: "u1",
      role: "USER",
      status: "ACTIVE",
    });
    await expect(shortVideoUser(req)).rejects.toMatchObject({ status: 403 });
    mocks.user.mockResolvedValueOnce({
      id: "u1",
      role: "ADMIN",
      status: "BANNED",
    });
    await expect(shortVideoUser(req)).rejects.toMatchObject({ status: 403 });
  });
  it("requires same origin for all mutating operations", async () => {
    const req = (origin?: string) =>
      new NextRequest("https://example.test/api/short-videos/videos", {
        method: "POST",
        headers: origin ? { Origin: origin } : {},
      });
    await expect(shortVideoUser(req())).rejects.toMatchObject({
      code: "ORIGIN_DENIED",
    });
    await expect(
      shortVideoUser(req("https://evil.test"))
    ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
    await expect(
      shortVideoUser(req("https://example.test"))
    ).resolves.toMatchObject({ id: "u1" });
  });
  it("returns structured rate and sanitized internal errors", async () => {
    mocks.rate.mockResolvedValue({ success: false });
    const res = await shortVideoUser(
      new NextRequest("https://example.test/api/short-videos/videos")
    );
    expect(res).toHaveProperty("status", 429);
    const error = await shortVideoError(
      new Error("secret-token"),
      "request"
    ).json();
    expect(JSON.stringify(error)).not.toContain("secret-token");
    expect(
      shortVideoError(new SvError(409, "CONFLICT", "版本过期"), "request")
        .status
    ).toBe(409);
  });
  it("rejects malformed and overlong JSON before services", async () => {
    await expect(
      shortVideoBody(
        new Request("https://example.test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        })
      )
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      shortVideoBody(
        new Request("https://example.test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "x".repeat(100001),
        })
      )
    ).rejects.toMatchObject({ status: 413 });
  });
});
