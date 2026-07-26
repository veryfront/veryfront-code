import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizePlugins } from "./plugin-utils.ts";

describe("build/renderer/utils/plugin-utils", () => {
  describe("normalizePlugins", () => {
    it("should return empty array for undefined input", () => {
      assertEquals(normalizePlugins(undefined), []);
    });

    it("should return empty array for empty array input", () => {
      assertEquals(normalizePlugins([]), []);
    });

    it("preserves Unified plugin tuples and their option identity", () => {
      const plugin = () => {};
      const options = { prefix: "docs" };
      const tuple = [plugin, options] as const;
      const result = normalizePlugins([tuple]);

      assertEquals(result.length, 1);
      assertStrictEquals(result[0], tuple);
      assertStrictEquals((result[0] as readonly unknown[])[1], options);
    });

    it("should pass through a flat array of plugins", () => {
      const pluginA = () => {};
      const pluginB = () => {};
      const result = normalizePlugins([pluginA, pluginB]);

      assertEquals(result, [pluginA, pluginB]);
    });
  });
});
