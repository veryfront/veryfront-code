import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ResolveFileOptions, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { findSourceFile } from "./index.ts";

describe("rendering/orchestrator/file-resolver", () => {
  it("does not resolve source imports through an implicit pages/ fallback", async () => {
    const resolveCalls: Array<{ basePath: string; allowPagesPrefix?: boolean }> = [];

    const adapter = {
      fs: {
        resolveFile: async (basePath: string, options?: ResolveFileOptions) => {
          resolveCalls.push({ basePath, allowPagesPrefix: options?.allowPagesPrefix });
          return null;
        },
        stat: async (path: string) => {
          if (path === "/project/pages/about.tsx") {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: 1,
              mtime: new Date(),
            };
          }
          throw new Error("File not found");
        },
      },
    } as unknown as RuntimeAdapter;

    const result = await findSourceFile("about", "/project", adapter);

    assertEquals(result, null);
    assertEquals(resolveCalls, [{ basePath: "/project/about", allowPagesPrefix: false }]);
  });
});
