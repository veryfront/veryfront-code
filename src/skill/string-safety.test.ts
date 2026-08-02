import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasControlCharacters, isUtf8WithinByteLimit, isWellFormedUtf16 } from "./string-safety.ts";

describe("src/skill/string-safety", () => {
  it("keeps character validation independent of later charCodeAt mutation", () => {
    const original = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt");
    let hookCalls = 0;
    let containsControls = false;
    let wellFormed = true;
    Object.defineProperty(String.prototype, "charCodeAt", {
      configurable: true,
      value() {
        hookCalls += 1;
        return 0x61;
      },
      writable: true,
    });

    try {
      containsControls = hasControlCharacters("\u0000");
      wellFormed = isWellFormedUtf16("\ud800");
    } finally {
      if (original) Object.defineProperty(String.prototype, "charCodeAt", original);
    }

    assertEquals(containsControls, true);
    assertEquals(wellFormed, false);
    assertEquals(hookCalls, 0);
  });

  it("keeps UTF-8 budgets independent of later numeric and string intrinsic mutation", () => {
    const originalSafeInteger = Object.getOwnPropertyDescriptor(Number, "isSafeInteger");
    const originalCharCodeAt = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt");
    let hookCalls = 0;
    let withinBudget = false;
    Object.defineProperty(Number, "isSafeInteger", {
      configurable: true,
      value() {
        hookCalls += 1;
        return false;
      },
      writable: true,
    });
    Object.defineProperty(String.prototype, "charCodeAt", {
      configurable: true,
      value() {
        hookCalls += 1;
        return 0x1f680;
      },
      writable: true,
    });

    try {
      withinBudget = isUtf8WithinByteLimit("abc", 3);
    } finally {
      if (originalSafeInteger) {
        Object.defineProperty(Number, "isSafeInteger", originalSafeInteger);
      }
      if (originalCharCodeAt) {
        Object.defineProperty(String.prototype, "charCodeAt", originalCharCodeAt);
      }
    }

    assertEquals(withinBudget, true);
    assertEquals(hookCalls, 0);
  });
});
