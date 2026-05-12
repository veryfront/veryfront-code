import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { constantTimeEqual } from "./constant-time.ts";

describe("constantTimeEqual", () => {
  it("should return true for equal strings", () => {
    assertEquals(constantTimeEqual("abc", "abc"), true);
    assertEquals(constantTimeEqual("", ""), true);
    assertEquals(constantTimeEqual("Bearer token123", "Bearer token123"), true);
  });

  it("should return false for different strings", () => {
    assertEquals(constantTimeEqual("abc", "def"), false);
    assertEquals(constantTimeEqual("abc", "abd"), false);
    assertEquals(constantTimeEqual("abc", "ab"), false);
  });

  it("should return false for different lengths", () => {
    assertEquals(constantTimeEqual("short", "longer-string"), false);
    assertEquals(constantTimeEqual("a", ""), false);
    assertEquals(constantTimeEqual("", "a"), false);
  });

  it("should handle unicode correctly", () => {
    assertEquals(constantTimeEqual("héllo", "héllo"), true);
    assertEquals(constantTimeEqual("héllo", "hello"), false);
  });

  it("should handle base64 encoded credentials", () => {
    const encoded = btoa("user:pass");
    assertEquals(constantTimeEqual(`Basic ${encoded}`, `Basic ${encoded}`), true);
    assertEquals(constantTimeEqual(`Basic ${encoded}`, "Basic wrong"), false);
  });

  it("should reject when only lengths differ but content prefix matches", () => {
    assertEquals(constantTimeEqual("abc", "abcdef"), false);
    assertEquals(constantTimeEqual("abcdef", "abc"), false);
  });

  it("should reject length-mismatch candidates regardless of shared prefix size", () => {
    const secret = "a".repeat(1000);
    const prefixOnly = "a".repeat(999);
    const prefixPlusExtra = `${secret}a`;

    assertEquals(constantTimeEqual(secret, prefixOnly), false);
    assertEquals(constantTimeEqual(secret, prefixPlusExtra), false);
  });
});
