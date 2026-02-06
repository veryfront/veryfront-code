/**
 * Tests for config-generator
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPackageJson } from "./config-generator.ts";

describe("config-generator", () => {
  describe("createPackageJson", () => {
    it("is a function", () => {
      assertEquals(typeof createPackageJson, "function");
    });

    it("is an async function", () => {
      assertEquals(createPackageJson.constructor.name, "AsyncFunction");
    });
  });
});
