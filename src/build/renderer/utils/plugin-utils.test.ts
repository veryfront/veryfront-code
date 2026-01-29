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

    it("should flatten nested plugin arrays", () => {
      const pluginA = () => {};
      const pluginB = () => {};
      const result = normalizePlugins(
        [[pluginA], [pluginB]] as unknown as import("unified").PluggableList,
      );
      assertEquals(result.length, 2);
      assertEquals(result[0], pluginA);
      assertEquals(result[1], pluginB);
    });

    it("should pass through a flat array of plugins", () => {
      const pluginA = () => {};
      const pluginB = () => {};
      const result = normalizePlugins(
        [pluginA, pluginB] as unknown as import("unified").PluggableList,
      );
      assertEquals(result.length, 2);
      assertEquals(result[0], pluginA);
      assertEquals(result[1], pluginB);
    });
  });
});
