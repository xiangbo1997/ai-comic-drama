import { describe, it, expect } from "vitest";
import { categorizeError } from "@/services/queue-errors";

describe("categorizeError()", () => {
  it("classifies fetch network error as retryable network", () => {
    const r = categorizeError(new Error("fetch failed"));
    expect(r.category).toBe("network");
    expect(r.retryable).toBe(true);
  });

  it("classifies provider 401 as non-retryable provider", () => {
    const r = categorizeError(
      new Error("HTTP 401 Unauthorized: invalid api key")
    );
    expect(r.category).toBe("provider");
    expect(r.retryable).toBe(false);
  });

  it("classifies validation 400 / content-safety as non-retryable validation", () => {
    const r = categorizeError(new Error("HTTP 400 content safety not passed"));
    expect(r.category).toBe("validation");
    expect(r.retryable).toBe(false);
  });
});
