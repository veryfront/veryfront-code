import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { constantTimeEqual } from "./constant-time.ts";

describe("constantTimeEqual", () => {
  it("should return true for equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("Bearer token123", "Bearer token123")).toBe(true);
  });

  it("should return false for different strings", () => {
    expect(constantTimeEqual("abc", "def")).toBe(false);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });

  it("should return false for different lengths", () => {
    expect(constantTimeEqual("short", "longer-string")).toBe(false);
    expect(constantTimeEqual("a", "")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
  });

  it("should handle unicode correctly", () => {
    expect(constantTimeEqual("héllo", "héllo")).toBe(true);
    expect(constantTimeEqual("héllo", "hello")).toBe(false);
  });

  it("should handle base64 encoded credentials", () => {
    const encoded = btoa("user:pass");
    expect(constantTimeEqual(`Basic ${encoded}`, `Basic ${encoded}`)).toBe(true);
    expect(constantTimeEqual(`Basic ${encoded}`, "Basic wrong")).toBe(false);
  });

  it("should reject when only lengths differ but content prefix matches", () => {
    expect(constantTimeEqual("abc", "abcdef")).toBe(false);
    expect(constantTimeEqual("abcdef", "abc")).toBe(false);
  });

  it("should not have timing difference between length mismatch and content mismatch", () => {
    const secret = "a".repeat(1000);
    const sameLenWrong = "b".repeat(1000);
    const diffLenWrong = "b".repeat(500);

    const iterations = 5000;

    // Warm up JIT
    for (let i = 0; i < 1000; i++) {
      constantTimeEqual(secret, sameLenWrong);
      constantTimeEqual(secret, diffLenWrong);
    }

    // Measure same-length comparison
    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      constantTimeEqual(secret, sameLenWrong);
    }
    const sameLenTime = performance.now() - t1;

    // Measure different-length comparison
    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      constantTimeEqual(secret, diffLenWrong);
    }
    const diffLenTime = performance.now() - t2;

    // The different-length comparison should take at least as long as same-length
    // (it iterates over max length). Allow generous margin for JIT variance.
    // The key assertion: diffLenTime should NOT be significantly faster than sameLenTime,
    // which would indicate an early-return on length mismatch.
    const ratio = diffLenTime / sameLenTime;
    expect(ratio).toBeGreaterThan(0.5);
  });
});
