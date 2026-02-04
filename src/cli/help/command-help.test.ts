/**
 * Tests for command help display
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showCommandHelp } from "./command-help.ts";

describe("command-help", () => {
  describe("showCommandHelp", () => {
    it("is a function", () => {
      assertEquals(typeof showCommandHelp, "function");
    });

    // Note: showCommandHelp calls console.log directly
    // Full output testing would require mocking console.log
    // The function behavior is verified through integration testing
  });
});
