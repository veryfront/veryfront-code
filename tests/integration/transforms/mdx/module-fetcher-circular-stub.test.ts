import "#veryfront/schemas/_test-setup.ts";

// Relocated from the colocated unit test: proving that the cycle-closing module
// is rewritten onto a generated stub requires reading the emitted cache files
// back off disk, which the unit boundary does not allow.

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import { fromFileUrl } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";

function createCircularAdapter(): RuntimeAdapter {
  const sourceByPath = new Map<string, string>([
    [
      "/virtual/a.ts",
      `import B from "./b.js"; export default function A() { return B; }`,
    ],
    [
      "/virtual/b.ts",
      `import A from "./a.js"; export default function B() { return A; }`,
    ],
  ]);

  return {
    env: { get: (_key: string) => undefined },
    fs: {
      resolveFile: (path: string) => {
        if (path === "a") return Promise.resolve("/virtual/a.ts");
        if (path === "b") return Promise.resolve("/virtual/b.ts");
        return Promise.resolve(null);
      },
      readFile: (path: string) => {
        const source = sourceByPath.get(path);
        if (!source) throw new Error(`File not found: ${path}`);
        return Promise.resolve(source);
      },
    },
  } as unknown as RuntimeAdapter;
}

describe("module-fetcher circular imports", () => {
  // Transforming a real module starts esbuild's child process; stop it so the
  // handle does not leak into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("falls back to stub resolution in non-strict mode", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-cycle-nonstrict-cache-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-cycle-nonstrict-proj-" });
    const adapter = createCircularAdapter();

    try {
      const ctx = createModuleFetcherContext(esmCacheDir, adapter, projectDir, "proj-cycle", {
        strictMissingModules: false,
      });

      const result = await fetchAndCacheModule("/_vf_modules/a.js", ctx);
      assertEquals(typeof result, "string", "a non-strict cycle resolves to a cached module path");
      assertEquals(result?.endsWith(".mjs"), true, "the cached module is an .mjs file");

      // a.mjs imports the persisted b module; b closes the cycle back onto a
      // through a generated stub. Neither may keep a bare relative specifier.
      assertExists(result, "the non-strict cycle must produce a cached module path");
      const codeA = await readTextFile(result);
      assertEquals(
        codeA.includes("./b.js"),
        false,
        "no unresolved relative specifier survives in the cached module",
      );
      const dependencyUrl = codeA.match(/"(file:\/\/[^"]+\.mjs)"/)?.[1];
      assertExists(
        dependencyUrl,
        "the cyclic import must be rewritten to a resolved file:// module",
      );
      const codeB = await readTextFile(fromFileUrl(dependencyUrl));
      assertEquals(
        /from "file:\/\/[^"]*stub-[a-f0-9]+\.mjs"/.test(codeB),
        true,
        "the cyclic import is replaced by a generated stub module",
      );
      assertEquals(
        codeB.includes("./a.js"),
        false,
        "no unresolved relative specifier survives in the cycle-closing module",
      );
    } finally {
      await remove(esmCacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  });
});
