/**
 * Tests for serve-split command (split mode orchestration)
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runSplitMode } from "./split-mode.ts";

describe("serve-split command", () => {
  describe("runSplitMode", () => {
    it("is a function", () => {
      assertEquals(typeof runSplitMode, "function");
    });

    it("is an async function", () => {
      assertEquals(runSplitMode.constructor.name, "AsyncFunction");
    });

    it("accepts options object with expected properties", () => {
      assertEquals(runSplitMode.length, 1);
    });
  });
});
