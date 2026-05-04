import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getRehypePlugins, getRemarkPlugins } from "./plugin-loader.ts";

function assertPluginArray(plugins: unknown): asserts plugins is unknown[] {
  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
}

describe("plugin-loader", () => {
  describe("getRemarkPlugins", () => {
    it("returns array of plugins", () => {
      const plugins = getRemarkPlugins();
      assertPluginArray(plugins);
      assertEquals(plugins.length > 0, true);
    });

    it("includes the baseline remark plugins", () => {
      const plugins = getRemarkPlugins();
      assertPluginArray(plugins);
      assertExists(plugins[0]);
      assertExists(plugins[1]);
      assertEquals(plugins.length >= 5, true);
    });
  });

  describe("getRehypePlugins", () => {
    it("returns array of plugins", () => {
      const plugins = getRehypePlugins();
      assertPluginArray(plugins);
      assertEquals(plugins.length > 0, true);
    });

    it("includes rehype-highlight and rehype-slug", () => {
      const plugins = getRehypePlugins();
      assertPluginArray(plugins);
      assertExists(plugins[0]);
      assertExists(plugins[1]);
      assertEquals(plugins.length >= 2, true);
    });
  });
});
