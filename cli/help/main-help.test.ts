/**
 * Tests for main help display
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showMainHelp } from "./main-help.ts";

describe("main-help", () => {
  describe("showMainHelp", () => {
    it("is a function", () => {
      assertEquals(typeof showMainHelp, "function");
    });

    // Note: showMainHelp calls console.log directly
    // Full output testing would require mocking console.log
    // The function behavior is verified through integration testing
  });
});
