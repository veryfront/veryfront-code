/**
 * Tests for routes command
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { routesCommand } from "./index.ts";

describe("routes command", () => {
  describe("routesCommand", () => {
    it("is a function", () => {
      assertEquals(typeof routesCommand, "function");
    });

    it("accepts projectDir and options parameters", () => {
      // Verify function signature
      assertExists(routesCommand);
      // Function has 1 required parameter (options has default)
      assertEquals(routesCommand.length, 1);
    });

    // Note: Full testing of routesCommand requires:
    // - A valid project directory with veryfront.config.ts
    // - Mocking the filesystem
    // - Mocking the runtime adapter
    // Integration tests should cover the actual route scanning behavior
  });
});
