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

it("ignores filesystem methods inherited from Object.prototype", async () => {
  const originalLstat = Object.getOwnPropertyDescriptor(Object.prototype, "lstat");
  const originalRealPath = Object.getOwnPropertyDescriptor(Object.prototype, "realPath");
  const snapshotPaths: string[] = [];

  try {
    Object.defineProperty(Object.prototype, "lstat", {
      value: () => Promise.resolve({ isSymlink: true }),
      configurable: true,
    });
    Object.defineProperty(Object.prototype, "realPath", {
      value: () => Promise.resolve("/project/redirected.ts"),
      configurable: true,
    });

    const adapter = {
      fs: {
        symlinkSemantics: "native",
        readFileSnapshotWithinLimit: (path: string) => {
          snapshotPaths.push(path);
          return Promise.resolve(new TextEncoder().encode("export const safe = true;"));
        },
      },
    } as unknown as RuntimeAdapter;
    const validator = new SSRDependencyValidator(
      () => Promise.resolve({ tempPath: "/tmp/child.js", contentHash: "hash" }),
      () => Promise.resolve(""),
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

    assertEquals(snapshotPaths, ["/project/child.ts"]);
    assertEquals(validator.missingDependencies, []);
  } finally {
    if (originalLstat) Object.defineProperty(Object.prototype, "lstat", originalLstat);
    else Reflect.deleteProperty(Object.prototype, "lstat");
    if (originalRealPath) {
      Object.defineProperty(Object.prototype, "realPath", originalRealPath);
    } else {
      Reflect.deleteProperty(Object.prototype, "realPath");
    }
  }
});
