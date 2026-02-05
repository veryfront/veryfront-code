/**
 * Tests for lock command
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { lockCommand } from "./index.ts";

describe("lock command", () => {
  describe("lockCommand", () => {
    it("is a function", () => {
      assertEquals(typeof lockCommand, "function");
    });

    it("accepts options with projectDir", () => {
      assertEquals(lockCommand.length, 1);
    });
  });
});
