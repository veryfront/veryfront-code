/**
 * Tests for generate command
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateCommand } from "./index.ts";

describe("generate command", () => {
  describe("generateCommand", () => {
    it("is a function", () => {
      assertEquals(typeof generateCommand, "function");
    });

    it("is an async function", () => {
      assertEquals(generateCommand.constructor.name, "AsyncFunction");
    });

    it("accepts projectDir, type, and name parameters", () => {
      assertEquals(generateCommand.length, 3);
    });
  });
});
