import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { walk } from "#std/fs/walk";

describe("veryfront platform adapter boundaries", () => {
  it("does not import html style-builder internals from platform code", async () => {
    const violations: string[] = [];

    for await (const entry of walk("src/platform", { includeFiles: true, exts: [".ts"] })) {
      if (!entry.isFile || entry.name.includes(".test.")) continue;

      const source = await Deno.readTextFile(entry.path);
      if (source.includes("html/styles-builder")) {
        violations.push(entry.path);
      }
    }

    assertEquals(violations, []);
  });
});
