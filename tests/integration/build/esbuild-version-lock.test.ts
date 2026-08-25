import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ESBUILD_VERSION } from "#veryfront/platform/compat/esbuild-shared.ts";

// Reads the repo lockfile, which the unit boundary forbids, so it lives here.
describe("integration/build/esbuild-version-lock", () => {
  it("tracks the npm:esbuild version resolved in deno.lock", async () => {
    const lock = JSON.parse(
      await Deno.readTextFile(new URL("../../../deno.lock", import.meta.url)),
    ) as { specifiers: Record<string, string> };
    const locked = Object.entries(lock.specifiers)
      .find(([key]) => key.startsWith("npm:esbuild@"))?.[1];
    assertEquals(
      ESBUILD_VERSION,
      locked,
      "the WASM/VFS esbuild version must track the npm:esbuild version resolved in deno.lock",
    );
  });
});
