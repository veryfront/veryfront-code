/**
 * Tests for clean command
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cleanCommand } from "./clean.ts";

describe("clean command", () => {
  describe("cleanCommand", () => {
    it("is a function", () => {
      assertEquals(typeof cleanCommand, "function");
    });

    it("accepts options with projectDir", () => {
      assertEquals(cleanCommand.length, 1);
    });
  });
});
