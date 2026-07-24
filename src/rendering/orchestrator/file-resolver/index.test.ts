import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ResolveFileOptions, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { findSourceFile } from "./index.ts";

describe("rendering/orchestrator/file-resolver", () => {
  it("resolves a specifier that already carries an explicit source extension", async () => {
    // Repro for the SSR `@/` alias bug: when a user writes
    //   import { Welcome } from "@/components/Welcome.tsx"
    // the alias resolver strips `@/` and passes `components/Welcome.tsx` to
    // findSourceFile. Historically the candidate builder only tried
    // `${fileName}${ext}` and `${fileName}/index${ext}` variants, so the
    // literal on-disk path was never a candidate and the file was reported
    // missing even though it existed. This test locks in the fix.
    const adapter = {
      fs: {
        stat: async (path: string) => {
          if (path === "/project/components/Welcome.tsx") {
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

    const result = await findSourceFile("components/Welcome.tsx", "/project", adapter);

    assertEquals(result, "/project/components/Welcome.tsx");
  });

  it("prefers the literal on-disk path over ext-appended candidates via resolveFile", async () => {
    const resolveCalls: string[] = [];
    const adapter = {
      fs: {
        resolveFile: async (basePath: string) => {
          resolveCalls.push(basePath);
          return basePath === "/project/components/Welcome.tsx"
            ? "/project/components/Welcome.tsx"
            : null;
        },
        stat: async () => {
          throw new Error("stat should not be reached when resolveFile succeeds");
        },
      },
    } as unknown as RuntimeAdapter;

    const result = await findSourceFile("components/Welcome.tsx", "/project", adapter);

    assertEquals(result, "/project/components/Welcome.tsx");
    assertEquals(resolveCalls[0], "/project/components/Welcome.tsx");
  });

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
