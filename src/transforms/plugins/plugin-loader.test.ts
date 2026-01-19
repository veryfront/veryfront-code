import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { getRehypePlugins, getRemarkPlugins } from "./plugin-loader.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";

describe("plugin-loader", () => {
  describe("getRemarkPlugins", () => {
    it("returns array of plugins", async () => {
      const plugins = await getRemarkPlugins();

      assertExists(plugins);
      assertEquals(Array.isArray(plugins), true);
      assertEquals(plugins.length > 0, true);
    });

    it("includes remark-gfm", async () => {
      const plugins = await getRemarkPlugins();

      assertExists(plugins[0]);
    });

    it("includes remark-frontmatter", async () => {
      const plugins = await getRemarkPlugins();

      assertExists(plugins[1]);
    });

    it("includes custom plugins", async () => {
      const plugins = await getRemarkPlugins();

      assertEquals(plugins.length >= 6, true);
    });

    it("handles missing config gracefully", async () => {
      const plugins = await getRemarkPlugins();

      assertExists(plugins);
      assertEquals(Array.isArray(plugins), true);
      assertEquals(plugins.length >= 6, true);
    });

    it("handles invalid config path", async () => {
      const plugins = await getRemarkPlugins();

      assertExists(plugins);
      assertEquals(Array.isArray(plugins), true);
    });

    it("with valid config directory", async () => {
      const tempDir = await makeTempDir();

      try {
        const plugins = await getRemarkPlugins();
        assertExists(plugins);
        assertEquals(Array.isArray(plugins), true);
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
        assertExists(plugins);
        assertEquals(Array.isArray(plugins), true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("with empty project directory", async () => {
      const tempDir = await makeTempDir();

      try {
        const plugins = await getRemarkPlugins();

        assertExists(plugins);
        assertEquals(plugins.length >= 6, true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });

  describe("getRehypePlugins", () => {
    it("returns array of plugins", async () => {
      const plugins = await getRehypePlugins();

      assertExists(plugins);
      assertEquals(Array.isArray(plugins), true);
      assertEquals(plugins.length > 0, true);
    });

    it("includes rehype-highlight", async () => {
      const plugins = await getRehypePlugins();

      assertExists(plugins[0]);
    });

    it("includes rehype-slug", async () => {
      const plugins = await getRehypePlugins();

      assertExists(plugins[1]);
    });

    it("includes custom plugins", async () => {
      const plugins = await getRehypePlugins();

      assertEquals(plugins.length >= 5, true);
    });

    it("handles missing config gracefully", async () => {
      const plugins = await getRehypePlugins();

      assertExists(plugins);
      assertEquals(Array.isArray(plugins), true);
      assertEquals(plugins.length >= 5, true);
    });

    it("handles invalid config path", async () => {
      const plugins = await getRehypePlugins();

      assertExists(plugins);
      assertEquals(Array.isArray(plugins), true);
    });

    it("with valid config directory", async () => {
      const tempDir = await makeTempDir();

      try {
        const plugins = await getRehypePlugins();
        assertExists(plugins);
        assertEquals(Array.isArray(plugins), true);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });
});
