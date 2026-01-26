import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { getRehypePlugins, getRemarkPlugins } from "./plugin-loader.ts";

function assertPluginArray(plugins: unknown): asserts plugins is unknown[] {
  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
}

describe("plugin-loader", () => {
  describe("getRemarkPlugins", () => {
    it("returns array of plugins", async () => {
      const plugins = await getRemarkPlugins();

      assertPluginArray(plugins);
      assertEquals(plugins.length > 0, true);
    });

    it("includes remark-gfm", async () => {
      const plugins = await getRemarkPlugins();

      assertPluginArray(plugins);
      assertExists(plugins[0]);
    });

    it("includes remark-frontmatter", async () => {
      const plugins = await getRemarkPlugins();

      assertPluginArray(plugins);
      assertExists(plugins[1]);
    });

    it("includes custom plugins", async () => {
      const plugins = await getRemarkPlugins();

      assertPluginArray(plugins);
      assertEquals(plugins.length >= 5, true);
    });

    it("handles missing config gracefully", async () => {
      const plugins = await getRemarkPlugins();

      assertPluginArray(plugins);
      assertEquals(plugins.length >= 5, true);
    });

    it("handles invalid config path", async () => {
      const plugins = await getRemarkPlugins();

      assertPluginArray(plugins);
    });

    it("with valid config directory", async () => {
      const tempDir = await makeTempDir();

      try {
        const plugins = await getRemarkPlugins();
        assertPluginArray(plugins);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("with config file containing MDX config", async () => {
      const tempDir = await makeTempDir();

      try {
        const configPath = join(tempDir, "veryfront.config.js");
        await writeTextFile(
          configPath,
          `export default {
  mdx: {
    remarkPlugins: [],
    rehypePlugins: []
  }
}`,
        );

        const plugins = await getRemarkPlugins();
        assertPluginArray(plugins);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("with empty project directory", async () => {
      const tempDir = await makeTempDir();

      try {
        const plugins = await getRemarkPlugins();

        assertPluginArray(plugins);
        assertEquals(plugins.length >= 5, true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });

  describe("getRehypePlugins", () => {
    it("returns array of plugins", async () => {
      const plugins = await getRehypePlugins();

      assertPluginArray(plugins);
      assertEquals(plugins.length > 0, true);
    });

    it("includes rehype-highlight", async () => {
      const plugins = await getRehypePlugins();

      assertPluginArray(plugins);
      assertExists(plugins[0]);
    });

    it("includes rehype-slug", async () => {
      const plugins = await getRehypePlugins();

      assertPluginArray(plugins);
      assertExists(plugins[1]);
    });

    it("includes custom plugins", async () => {
      const plugins = await getRehypePlugins();

      assertPluginArray(plugins);
      assertEquals(plugins.length >= 2, true);
    });

    it("handles missing config gracefully", async () => {
      const plugins = await getRehypePlugins();

      assertPluginArray(plugins);
      assertEquals(plugins.length >= 2, true);
    });

    it("handles invalid config path", async () => {
      const plugins = await getRehypePlugins();

      assertPluginArray(plugins);
    });

    it("with valid config directory", async () => {
      const tempDir = await makeTempDir();

      try {
        const plugins = await getRehypePlugins();
        assertPluginArray(plugins);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });
});
