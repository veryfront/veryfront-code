import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
          throw Object.assign(new Error("File not found"), { code: "ENOENT" });
        },
      },
    } as unknown as RuntimeAdapter;

    const result = await findSourceFile("about", "/project", adapter);

    assertEquals(result, null);
    assertEquals(resolveCalls, [{ basePath: "/project/about", allowPagesPrefix: false }]);
  });

  it("rejects traversal before consulting the filesystem", async () => {
    let calls = 0;
    const adapter = {
      fs: {
        resolveFile: () => {
          calls++;
          return Promise.resolve(null);
        },
        stat: () => {
          calls++;
          return Promise.reject(new Error("unexpected read"));
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => findSourceFile("../../outside", "/project", adapter),
      TypeError,
      "project-relative",
    );
    assertEquals(calls, 0);
  });

  it("rejects resolveFile results outside the project", async () => {
    const adapter = {
      fs: {
        resolveFile: () => Promise.resolve("/outside/component.tsx"),
        stat: () => Promise.reject(new Error("unexpected stat")),
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => findSourceFile("component", "/project", adapter),
      TypeError,
      "outside the project",
    );
  });
});
