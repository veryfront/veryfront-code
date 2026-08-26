import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteLocalImports } from "#veryfront/modules/react-loader/ssr-module-loader/import-rewriter.ts";

describe("rewriteLocalImports intrinsics", () => {
  it("consumes compiled MDX rewrite entries through captured map intrinsics", async () => {
    const compiledSpecifier = "file:///project/components/Child.tsx";
    const paths = new Map([[compiledSpecifier, "/tmp/Child.js"]]);
    const originalIterator = Map.prototype[Symbol.iterator];

    try {
      Map.prototype[Symbol.iterator] = (function* () {
        // Tenant SSR code must not be able to hide authenticated rewrite entries.
      }) as typeof originalIterator;

      const result = await rewriteLocalImports(
        `import Child from "${compiledSpecifier}";`,
        paths,
        "/project/page.mdx",
        "/project",
      );

      assertEquals(result, `import Child from "file:///tmp/Child.js";`);
    } finally {
      Map.prototype[Symbol.iterator] = originalIterator;
    }
  });
});
