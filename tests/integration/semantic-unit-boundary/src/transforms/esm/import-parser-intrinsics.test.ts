import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { parseLocalImports } from "#veryfront/transforms/esm/import-parser.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";

it("keeps containment when Promise.all is poisoned", async () => {
  const originalPromiseAll = Promise.all;
  let canonicalizationCalls = 0;
  const adapter = {
    fs: {
      resolveFile: () => Promise.resolve("/project/child.tsx"),
      realPath: (path: string) => {
        canonicalizationCalls++;
        return Promise.resolve(path);
      },
    },
  } as unknown as RuntimeAdapter;
  try {
    Promise.all = ((values: Iterable<unknown>) => {
      if (canonicalizationCalls >= 2) {
        return Promise.resolve(["/", "/external/secret.tsx"]);
      }
      return Reflect.apply(originalPromiseAll, Promise, [[...values]]) as Promise<unknown[]>;
    }) as typeof Promise.all;

    const result = await parseLocalImports(
      'import Child from "@/child.tsx";',
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(
      result.imports.some((entry) => entry.absolutePath === "/external/secret.tsx"),
      false,
    );
  } finally {
    Promise.all = originalPromiseAll;
    await stopEsbuild();
  }
});

it("keeps containment when String prototype methods are poisoned", async () => {
  const originalReplaceAll = String.prototype.replaceAll;
  const originalStartsWith = String.prototype.startsWith;
  const adapter = {
    fs: {
      resolveFile: () => Promise.resolve("/external/secret.tsx"),
      realPath: (path: string) => Promise.resolve(path),
    },
  } as unknown as RuntimeAdapter;
  try {
    String.prototype.replaceAll = function (
      this: string,
      searchValue: string | RegExp,
      replaceValue: string,
    ): string {
      if (String(this).includes("secret.tsx") && searchValue === "\\") return "";
      return Reflect.apply(originalReplaceAll, this, [searchValue, replaceValue]);
    } as typeof String.prototype.replaceAll;
    String.prototype.startsWith = function (
      this: string,
      searchString: string,
      position?: number,
    ): boolean {
      if (
        String(this).includes("secret.tsx") &&
        (searchString === "../" || searchString === "/")
      ) return false;
      return Reflect.apply(originalStartsWith, this, [searchString, position]);
    };

    const result = await parseLocalImports(
      'import Secret from "@/../secret.tsx";',
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(result.imports, []);
  } finally {
    String.prototype.replaceAll = originalReplaceAll;
    String.prototype.startsWith = originalStartsWith;
    await stopEsbuild();
  }
});
