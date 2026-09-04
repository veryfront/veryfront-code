import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getMdxEsmSsrCacheDirs } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";

it("rejects a legacy traversal when project code replaces String.startsWith", async () => {
  const cacheBase = await makeTempDir({ prefix: "vf-mdx-primordial-containment-" });
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, "startsWith");
  let cacheDirs: string[] = [];

  try {
    await runWithCacheDir(cacheBase, () => {
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        writable: true,
        value: () => true,
      });
      try {
        cacheDirs = getMdxEsmSsrCacheDirs("project-primordial", "../../escape");
      } finally {
        if (descriptor) Object.defineProperty(String.prototype, "startsWith", descriptor);
      }
    });

    assertEquals(cacheDirs.length, 3);
  } finally {
    if (descriptor) Object.defineProperty(String.prototype, "startsWith", descriptor);
    await remove(cacheBase, { recursive: true });
  }
});
