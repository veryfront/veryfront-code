import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import { SSRDependencyValidator } from "#veryfront/modules/react-loader/ssr-module-loader/ssr-dependency-validator.ts";

it("uses captured descriptor authority for symlink semantics", async () => {
  const directReads: string[] = [];
  const snapshotReads: string[] = [];
  const fs = {
    symlinkSemantics: "native",
    readFile: (path: string) => {
      directReads.push(path);
      return Promise.resolve("direct");
    },
    readFileSnapshotWithinLimit: (path: string) => {
      snapshotReads.push(path);
      return Promise.resolve(new TextEncoder().encode("snapshot"));
    },
  };
  const originalDescriptor = Object.getOwnPropertyDescriptor;
  try {
    Object.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) =>
      target === fs && key === "symlinkSemantics"
        ? { configurable: true, enumerable: true, value: "none", writable: true }
        : originalDescriptor(target, key)) as typeof Object.getOwnPropertyDescriptor;
    const adapter = { fs } as unknown as RuntimeAdapter;
    const sources: Array<string | undefined> = [];
    const validator = new SSRDependencyValidator(
      (_path, source) => {
        sources.push(source);
        return Promise.resolve({ tempPath: "/tmp/child.js", contentHash: "hash" });
      },
      () =>
        Promise.resolve(""),
      adapter,
      "/project",
    );

    await validator.processLocalImports(
      [{
        absolutePath: "/project/child.ts",
        requestedPath: "/project/child.ts",
        projectContained: true,
        specifier: "./child.ts",
      }],
      "/project/page.ts",
      0,
      createFileSystem(),
      createDependencyHashCache(),
    );

    assertEquals(snapshotReads, ["/project/child.ts"]);
    assertEquals(directReads, []);
    assertEquals(sources, ["snapshot"]);
  } finally {
    Object.getOwnPropertyDescriptor = originalDescriptor;
  }
});
