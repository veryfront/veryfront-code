/**
 * Tests for logo display
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showAsciiLogo } from "./logo.ts";

describe("logo", () => {
  describe("showAsciiLogo", () => {
    it("is a function", () => {
      assertEquals(typeof showAsciiLogo, "function");
    });

    // Note: showAsciiLogo calls console.log directly, so we just verify it's callable
    // Full output testing would require mocking console.log
  });
});
