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
});
