/**
 * Real-filesystem middleware loading.
 *
 * `loadMiddlewareFile` takes a different path when the adapter is not a
 * virtual filesystem (the deno compile case): it transpiles the TypeScript
 * source into an adjacent temp module, imports it, and removes the temp file.
 * That path needs a real directory, so it lives here rather than beside the
 * hermetic unit cases in src/server/dev-server/middleware.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { readDir, readTextFile, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadMiddlewareFile } from "#veryfront/server/dev-server/middleware.ts";

function createRealFsAdapter(middlewarePath: string): RuntimeAdapter {
  // No isVeryfrontAdapter and no getAdapterType, so isVirtualFilesystem is false
  // and the real-filesystem (deno compile) loading path is taken.
  const fs = {
    exists: (path: string) => Promise.resolve(path === middlewarePath),
    readFile: (path: string) => readTextFile(path),
  } as unknown as RuntimeAdapter["fs"];

  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs,
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

describe("loadMiddlewareFile on a real filesystem", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("transpiles and imports a TypeScript middleware from the real filesystem", async () => {
    await withTempDir(async (dir) => {
      const middlewarePath = join(dir, "middleware.ts");
      await writeTextFile(
        middlewarePath,
        "export default async function (c: unknown, next: () => Promise<Response>) { return await next(); }",
      );
      const adapter = createRealFsAdapter(middlewarePath);

      const loaded = await loadMiddlewareFile(dir, adapter, {
        throwOnError: true,
        allowHostProjectCodeExecution: true,
      });

      assertEquals(
        loaded.length,
        1,
        "a real-filesystem TypeScript middleware is transpiled and imported",
      );
      assertEquals(typeof loaded[0], "function", "the imported default export is a function");

      const leftovers: string[] = [];
      for await (const entry of readDir(dir)) {
        if (entry.name.startsWith(".vf-middleware-")) leftovers.push(entry.name);
      }
      assertEquals(leftovers, [], "the adjacent temp module is removed after import");
    }, { prefix: "vf-middleware-real-fs-" });
  });
});
