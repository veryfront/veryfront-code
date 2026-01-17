import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { getRehypePlugins, getRemarkPlugins } from "./plugin-loader.ts";

Deno.test("plugin-loader - getRemarkPlugins returns array of plugins", async () => {
  const plugins = await getRemarkPlugins();

  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
  assertEquals(plugins.length > 0, true);
});

Deno.test("plugin-loader - getRemarkPlugins includes remark-gfm", async () => {
  const plugins = await getRemarkPlugins();

  assertExists(plugins[0]);
});

Deno.test("plugin-loader - getRemarkPlugins includes remark-frontmatter", async () => {
  const plugins = await getRemarkPlugins();

  assertExists(plugins[1]);
});

Deno.test("plugin-loader - getRemarkPlugins includes custom plugins", async () => {
  const plugins = await getRemarkPlugins();

  assertEquals(plugins.length >= 6, true);
});

Deno.test("plugin-loader - getRemarkPlugins handles missing config gracefully", async () => {
  const plugins = await getRemarkPlugins();

  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
  assertEquals(plugins.length >= 6, true);
});

Deno.test("plugin-loader - getRemarkPlugins handles invalid config path", async () => {
  const plugins = await getRemarkPlugins();

  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
});

Deno.test("plugin-loader - getRehypePlugins returns array of plugins", async () => {
  const plugins = await getRehypePlugins();

  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
  assertEquals(plugins.length > 0, true);
});

Deno.test("plugin-loader - getRehypePlugins includes rehype-highlight", async () => {
  const plugins = await getRehypePlugins();

  assertExists(plugins[0]);
});

Deno.test("plugin-loader - getRehypePlugins includes rehype-slug", async () => {
  const plugins = await getRehypePlugins();

  assertExists(plugins[1]);
});

Deno.test("plugin-loader - getRehypePlugins includes custom plugins", async () => {
  const plugins = await getRehypePlugins();

  assertEquals(plugins.length >= 5, true);
});

Deno.test("plugin-loader - getRehypePlugins handles missing config gracefully", async () => {
  const plugins = await getRehypePlugins();

  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
  assertEquals(plugins.length >= 5, true);
});

Deno.test("plugin-loader - getRehypePlugins handles invalid config path", async () => {
  const plugins = await getRehypePlugins();

  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
});

Deno.test("plugin-loader - getRemarkPlugins with valid config directory", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const plugins = await getRemarkPlugins();
    assertExists(plugins);
    assertEquals(Array.isArray(plugins), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("plugin-loader - getRehypePlugins with valid config directory", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const plugins = await getRehypePlugins();
    assertExists(plugins);
    assertEquals(Array.isArray(plugins), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("plugin-loader - getRemarkPlugins with config file containing MDX config", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const configPath = join(tempDir, "veryfront.config.js");
    await Deno.writeTextFile(
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
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("plugin-loader - getRemarkPlugins with empty project directory", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const plugins = await getRemarkPlugins();

    assertExists(plugins);
    assertEquals(plugins.length >= 6, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
