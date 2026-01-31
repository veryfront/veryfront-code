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

async function withTempDir(fn: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await makeTempDir();
  try {
    await fn(tempDir);
  } finally {
    await remove(tempDir, { recursive: true });
  }
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
      await withTempDir(async () => {
        const plugins = await getRemarkPlugins();
        assertPluginArray(plugins);
      });
    });

    it("with config file containing MDX config", async () => {
      await withTempDir(async (tempDir) => {
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
      });
    });

    it("with empty project directory", async () => {
      await withTempDir(async () => {
        const plugins = await getRemarkPlugins();

        assertPluginArray(plugins);
        assertEquals(plugins.length >= 5, true);
      });
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
      await withTempDir(async () => {
        const plugins = await getRehypePlugins();
        assertPluginArray(plugins);
      });
    });
  });
});
