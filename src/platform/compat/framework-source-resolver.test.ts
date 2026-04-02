import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getFrameworkSourceLookupDirs,
  resolveFrameworkSourcePath,
} from "./framework-source-resolver.ts";

describe("platform/compat/framework-source-resolver", () => {
  it("prefers live framework src before embedded sources", async () => {
    const stats = new Map<string, boolean>([
      ["/framework/src/react/router/index.tsx", true],
      ["/framework/dist/framework-src/react/router/index.tsx.src", true],
    ]);

    const result = await resolveFrameworkSourcePath("react/router", {
      extraLookupDirs: ["/framework/src", "/framework/dist/framework-src"],
      fileSystem: {
        stat: async (path: string) => {
          if (stats.get(path)) {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              isSymbolicLink: false,
              size: 0,
              mtime: null,
            };
          }

          throw new Error("not found");
        },
      },
    });

    assertEquals(result?.path, "/framework/src/react/router/index.tsx");
  });

  it("falls back to embedded sources when live src is missing", async () => {
    const result = await resolveFrameworkSourcePath("react/router", {
      extraLookupDirs: ["/framework/src", "/framework/dist/framework-src"],
      fileSystem: {
        stat: async (path: string) => {
          if (path === "/framework/dist/framework-src/react/router/index.tsx.src") {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              isSymbolicLink: false,
              size: 0,
              mtime: null,
            };
          }

          throw new Error("not found");
        },
      },
    });

    assertEquals(result?.path, "/framework/dist/framework-src/react/router/index.tsx.src");
  });

  it("deduplicates lookup directories while preserving order", () => {
    const lookupDirs = getFrameworkSourceLookupDirs(["/custom", "/custom"]);
    assertEquals(lookupDirs.filter((dir) => dir === "/custom").length, 1);
  });
});
