/**
 * Tests for config-generator
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPackageJson } from "./config-generator.ts";
import { join } from "veryfront/platform/path";

describe("config-generator", () => {
  describe("createPackageJson", () => {
    it("is a function", () => {
      assertEquals(typeof createPackageJson, "function");
    });

    it("is an async function", () => {
      assertEquals(createPackageJson.constructor.name, "AsyncFunction");
    });

    it("includes pnpm.onlyBuiltDependencies for esbuild and veryfront", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.pnpm?.onlyBuiltDependencies, ["esbuild", "veryfront"]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
