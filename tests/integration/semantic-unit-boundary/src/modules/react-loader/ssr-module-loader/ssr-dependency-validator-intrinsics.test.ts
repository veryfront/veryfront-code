import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import { SSRDependencyValidator } from "#veryfront/modules/react-loader/ssr-module-loader/ssr-dependency-validator.ts";
import { parseLocalImports } from "#veryfront/transforms/esm/import-parser.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";

afterAll(async () => {
  await stopEsbuild();
});

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

it("classifies contained imports through captured String.endsWith", async () => {
  const originalEndsWith = String.prototype.endsWith;
  try {
    String.prototype.endsWith = function (search: string, endPosition?: number): boolean {
      if (String(this) === "/project/child.ts" && search === ".css") return true;
      return Reflect.apply(originalEndsWith, this, [search, endPosition]);
    };
    const adapter = {
      fs: {
        symlinkSemantics: "none",
        resolveFile: () => Promise.resolve("/project/child.ts"),
      },
    } as unknown as RuntimeAdapter;

    const result = await parseLocalImports(
      `import Child from "file:///project/child.ts";\nexport default Child;`,
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(result.imports.length, 1);
    assertEquals(result.cssImports, []);
  } finally {
    String.prototype.endsWith = originalEndsWith;
  }
});

it("awaits contained reads through captured Promise.allSettled", async () => {
  const originalAllSettled = Promise.allSettled;
  let releaseRead!: (value: Uint8Array) => void;
  const read = new Promise<Uint8Array>((resolve) => {
    releaseRead = resolve;
  });
  const transformedPaths: string[] = [];
  const adapter = {
    fs: {
      symlinkSemantics: "native",
      readFileSnapshotWithinLimit: () => read,
    },
  } as unknown as RuntimeAdapter;
  const validator = new SSRDependencyValidator(
    (path) => {
      transformedPaths.push(path);
      return Promise.resolve({ tempPath: "/tmp/child.js", contentHash: "hash" });
    },
    () => Promise.resolve(""),
    adapter,
    "/project",
  );

  try {
    Promise.allSettled = (() => Promise.resolve([])) as typeof Promise.allSettled;
    const processing = validator.processLocalImports(
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
    const status = await Promise.race([
      processing.then(() => "settled" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 10)),
    ]);

    releaseRead(new TextEncoder().encode("export default null;"));
    const paths = await processing;

    assertEquals(status, "pending");
    assertEquals(transformedPaths, ["/project/child.ts"]);
    assertEquals(paths.get("./child.ts"), "/tmp/child.js");
  } finally {
    Promise.allSettled = originalAllSettled;
    releaseRead(new Uint8Array());
  }
});

it("records contained rewrite keys through captured Map.set", async () => {
  const originalSet = Map.prototype.set;
  const rewriteSpecifier = "file:///project/child.ts";
  const adapter = {
    fs: {
      symlinkSemantics: "none",
      readFile: () => Promise.resolve("export default null;"),
    },
  } as unknown as RuntimeAdapter;
  const validator = new SSRDependencyValidator(
    () => Promise.resolve({ tempPath: "/tmp/child.js", contentHash: "hash" }),
    () => Promise.resolve(""),
    adapter,
    "/project",
  );

  try {
    Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (key === rewriteSpecifier) return this;
      return Reflect.apply(originalSet, this, [key, value]);
    } as typeof Map.prototype.set;

    const paths = await validator.processLocalImports(
      [{
        absolutePath: "/project/child.ts",
        requestedPath: "/project/child.ts",
        projectContained: true,
        rewriteSpecifier,
        specifier: "./child.ts",
      }],
      "/project/page.ts",
      0,
      createFileSystem(),
      createDependencyHashCache(),
    );

    assertEquals(paths.get(rewriteSpecifier), "/tmp/child.js");
  } finally {
    Map.prototype.set = originalSet;
  }
});

it("routes portable Windows project paths through bound snapshot reads", async () => {
  const directReads: string[] = [];
  const snapshotReads: string[] = [];
  const transformedSources: Array<string | undefined> = [];
  const adapter = {
    fs: {
      symlinkSemantics: "native",
      readFile: (path: string) => {
        directReads.push(path);
        return Promise.resolve("export default 'direct';");
      },
      readFileSnapshotWithinLimit: (path: string) => {
        snapshotReads.push(path);
        return Promise.resolve(new TextEncoder().encode("export default 'snapshot';"));
      },
    },
  } as unknown as RuntimeAdapter;
  const validator = new SSRDependencyValidator(
    (_path, source) => {
      transformedSources.push(source);
      return Promise.resolve({ tempPath: "C:/cache/child.js", contentHash: "hash" });
    },
    () => Promise.resolve(""),
    adapter,
    "C:/project",
  );

  await validator.processLocalImports(
    [{
      absolutePath: "C:/project/child.ts",
      requestedPath: "C:/project/child.ts",
      specifier: "./child.ts",
    }],
    "C:/project/page.ts",
    0,
    createFileSystem(),
    createDependencyHashCache(),
  );

  assertEquals(snapshotReads, ["C:/project/child.ts"]);
  assertEquals(directReads, []);
  assertEquals(transformedSources, ["export default 'snapshot';"]);
});
