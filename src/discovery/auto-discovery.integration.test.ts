/**
 * Auto-Discovery Integration Tests
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { beforeEach, describe, it } from "#veryfront/testing/bdd";
import { toolRegistry } from "#veryfront/tool";
import { promptRegistry } from "#veryfront/prompt";
import { resourceRegistry } from "#veryfront/resource";
import { join, resolve } from "#veryfront/compat/path";
import { cwd } from "#veryfront/compat/process.ts";
import { discoverAll } from "./index.ts";

function getFixturePath(): string {
  return resolve(join(cwd(), "src", "discovery", "__fixtures__", "autodiscovery"));
}

describe(
  "Auto-Discovery Integration",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    beforeEach(() => {
      toolRegistry.clear();
      resourceRegistry.clear();
      promptRegistry.clear();
    });

    it("should discover tools from tools/ directory", async () => {
      const result = await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      assertEquals(result.tools.size >= 2, true);
      assertExists(result.tools.get("greet") ?? result.tools.get("searchWeb"));
    });

    it("should discover resources from resources/ directory", async () => {
      const result = await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      assertEquals(result.resources.size >= 1, true);
    });

    it("should discover prompts from prompts/ directory", async () => {
      const result = await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      assertEquals(result.prompts.size >= 1, true);
    });

    it("should register discovered tools in registry", async () => {
      await discoverAll({
        baseDir: getFixturePath(),
        verbose: false,
      });

      const toolIds = toolRegistry.getAllIds();
      assertEquals(toolIds.length >= 2, true);
    });

    it("should handle discovery errors gracefully", async () => {
      const result = await discoverAll({
        baseDir: "/nonexistent/path",
        verbose: false,
      });

      assertExists(result);
      assertExists(result.errors);
    });

    it("should discover all valid named exports from a single tool file", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-multi-export-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/many.ts`,
          [
            'export const alpha = { execute: async () => "alpha" };',
            'export const beta = { execute: async () => "beta" };',
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(Array.from(result.tools.keys()).sort(), ["alpha", "beta"]);
        assertEquals(toolRegistry.getAllIds().sort(), ["alpha", "beta"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("should keep concrete tool files over index barrel re-exports", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-discovery-barrel-" });

      try {
        await Deno.mkdir(`${tempDir}/tools`, { recursive: true });
        await Deno.writeTextFile(
          `${tempDir}/tools/foo.ts`,
          'export const foo = { execute: async () => "foo" };\n',
        );
        await Deno.writeTextFile(
          `${tempDir}/tools/bar.ts`,
          'export const bar = { execute: async () => "bar" };\n',
        );
        await Deno.writeTextFile(
          `${tempDir}/tools/index.ts`,
          [
            'export { foo } from "./foo.ts";',
            'export { bar } from "./bar.ts";',
          ].join("\n"),
        );

        const result = await discoverAll({
          baseDir: tempDir,
          verbose: false,
        });

        assertEquals(Array.from(result.tools.keys()).sort(), ["bar", "foo"]);
        assertEquals(toolRegistry.getAllIds().sort(), ["bar", "foo"]);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });
  },
);
