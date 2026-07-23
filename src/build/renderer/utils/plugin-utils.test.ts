import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

    it("preserves plugin tuples instead of flattening their options", () => {
      const pluginA = () => {};
      const tuple = [pluginA, { option: true }];
      const result = normalizePlugins([tuple]);

      assertEquals(result, [tuple]);
    });

    it("should pass through a flat array of plugins", () => {
      const pluginA = () => {};
      const pluginB = () => {};
      const result = normalizePlugins([pluginA, pluginB]);

      assertEquals(result, [pluginA, pluginB]);
    });
  });
});
