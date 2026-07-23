import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { expect } from "#std/expect.ts";
import {
  computeDepsHash,
  createDependencyHashCache,
  invalidateDependencyHashCache,
} from "./dependency-graph.ts";
import { computeConfigHash } from "./config-hash.ts";
import { buildTransformCacheKey } from "./keys.ts";

function createGetContent(files: Map<string, string>): (p: string) => Promise<string> {
  return (p) => {
    const content = files.get(p);
    if (content == null) return Promise.reject(new Error(`not found: ${p}`));
    return Promise.resolve(content);
  };
}

describe("Dependency tracking cache invalidation", () => {
  describe("computeDepsHash", () => {
    it("should produce different hash when dependency content changes", async () => {
      const helperV1 = "export function helper() { return 'v1'; }\n";
      const helperV2 = "export function helper() { return 'v2'; }\n";
      const mainCode =
        `import { helper } from "./helper.ts";\nexport default function() { return helper(); }\n`;

      const files1 = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/helper.ts", helperV1],
      ]);

      const hash1 = await computeDepsHash(
        "/project/pages/index.js",
        createGetContent(files1),
        "/project",
      );

      const files2 = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/helper.ts", helperV2],
      ]);

      const hash2 = await computeDepsHash(
        "/project/pages/index.js",
        createGetContent(files2),
        "/project",
      );

      expect(hash1).not.toBe(hash2);
    });

    it("should produce same hash when unrelated file changes", async () => {
      const mainCode =
        `import { helper } from "./helper.ts";\nexport default function() { return helper(); }\n`;
      const helperCode = "export function helper() { return 'stable'; }\n";

      const files = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/helper.ts", helperCode],
      ]);

      const getContent = createGetContent(files);

      const hash1 = await computeDepsHash("/project/pages/index.js", getContent, "/project");
      const hash2 = await computeDepsHash("/project/pages/index.js", getContent, "/project");

      expect(hash1).toBe(hash2);
    });

    it("should detect transitive dependency changes", async () => {
      const mainCode =
        `import { format } from "./formatter.ts";\nexport default function() { return format(); }\n`;
      const formatterCode =
        `import { utils } from "./utils.ts";\nexport function format() { return utils(); }\n`;
      const utilsV1 = "export function utils() { return 'v1'; }\n";
      const utilsV2 = "export function utils() { return 'v2'; }\n";

      const files1 = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/formatter.ts", formatterCode],
        ["/project/pages/utils.ts", utilsV1],
      ]);

      const hash1 = await computeDepsHash(
        "/project/pages/index.js",
        createGetContent(files1),
        "/project",
      );

      const files2 = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/formatter.ts", formatterCode],
        ["/project/pages/utils.ts", utilsV2],
      ]);

      const hash2 = await computeDepsHash(
        "/project/pages/index.js",
        createGetContent(files2),
        "/project",
      );

      expect(hash1).not.toBe(hash2);
    });

    it("resolves extensionless imports to the actual source file", async () => {
      const files = new Map<string, string>([
        ["/project/pages/index.ts", `import { helper } from "./helper"; export { helper };`],
        ["/project/pages/helper.ts", "export const helper = 1;"],
      ]);
      const reads: string[] = [];

      await computeDepsHash(
        "/project/pages/index.ts",
        async (path) => {
          reads.push(path);
          const content = files.get(path);
          if (content === undefined) throw new Error(`not found: ${path}`);
          return content;
        },
        "/project",
      );

      expect(reads).toContain("/project/pages/helper.ts");
    });

    it("tracks local import-map aliases and resets reused graphs when the map changes", async () => {
      const entryPath = "/project/pages/index.ts";
      const files = new Map<string, string>([
        [entryPath, `import { value } from "local"; export { value };`],
        ["/project/shared-v1.ts", "export const value = 'v1';"],
        ["/project/shared-v2.ts", "export const value = 'v2';"],
      ]);
      const cache = createDependencyHashCache();
      const read = createGetContent(files);

      const first = await computeDepsHash(entryPath, read, "/project", cache, {
        importMap: { imports: { local: "./shared-v1.ts" } },
        resolutionIdentity: "map-v1",
      });
      const second = await computeDepsHash(entryPath, read, "/project", cache, {
        importMap: { imports: { local: "./shared-v2.ts" } },
        resolutionIdentity: "map-v2",
      });

      expect(first).not.toBe(second);
      expect(cache.graph.getDirectDependencies(entryPath)).toEqual([
        "/project/shared-v2.ts",
      ]);
    });

    it("rejects dependency graphs with excessive import fan-out", async () => {
      const entryPath = "/project/pages/index.ts";
      const source = Array.from(
        { length: 1_001 },
        (_, index) => `import "package-${index}";`,
      ).join("\n");

      await assertRejects(
        () => computeDepsHash(entryPath, () => Promise.resolve(source), "/project"),
        Error,
        `Failed to resolve dependencies for ${entryPath}`,
      );
    });

    it("bounds concurrent dependency source reads", async () => {
      const entryPath = "/project/pages/index.ts";
      const dependencyCount = 20;
      const entrySource = Array.from(
        { length: dependencyCount },
        (_, index) => `import "./dep-${index}.ts";`,
      ).join("\n");
      let activeReads = 0;
      let maxActiveReads = 0;
      let markSaturated!: () => void;
      const saturated = new Promise<void>((resolve) => {
        markSaturated = resolve;
      });
      let releaseReads!: () => void;
      const readGate = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });

      const hash = computeDepsHash(
        entryPath,
        async (path) => {
          if (path === entryPath) return entrySource;
          activeReads++;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          if (activeReads === 8) markSaturated();
          try {
            await readGate;
            return "export {};";
          } finally {
            activeReads--;
          }
        },
        "/project",
      );

      await saturated;
      expect(activeReads).toBe(8);
      releaseReads();
      expect(typeof await hash).toBe("string");
      expect(maxActiveReads).toBe(8);
    });

    it("should reuse cached content for overlapping dependency graphs", async () => {
      const files = new Map<string, string>([
        [
          "/project/pages/a.js",
          `import { shared } from "../components/shared.ts";\nexport const a = shared;\n`,
        ],
        [
          "/project/pages/b.js",
          `import { shared } from "../components/shared.ts";\nexport const b = shared;\n`,
        ],
        ["/project/components/shared.ts", "export const shared = 1;\n"],
      ]);
      const reads = new Map<string, number>();
      const cache = createDependencyHashCache();

      const getContent = async (path: string): Promise<string> => {
        reads.set(path, (reads.get(path) ?? 0) + 1);
        const content = files.get(path);
        if (content == null) throw new Error(`not found: ${path}`);
        return content;
      };

      await computeDepsHash("/project/pages/a.js", getContent, "/project", cache);
      await computeDepsHash("/project/pages/b.js", getContent, "/project", cache);

      expect(reads.get("/project/components/shared.ts")).toBe(1);
    });

    it("rejects an incomplete identity when a dependency cannot be read and can retry", async () => {
      const entryPath = "/project/pages/index.js";
      const dependencyPath = "/project/pages/helper.ts";
      const files = new Map<string, string>([
        [
          entryPath,
          `import { helper } from "./helper.ts";\nexport default helper;\n`,
        ],
      ]);
      const cache = createDependencyHashCache();

      await assertRejects(
        () => computeDepsHash(entryPath, createGetContent(files), "/project", cache),
        Error,
        `Failed to resolve dependencies for ${entryPath}`,
      );

      files.set(dependencyPath, "export const helper = 'available';\n");
      const retriedHash = await computeDepsHash(
        entryPath,
        createGetContent(files),
        "/project",
        cache,
      );
      const freshHash = await computeDepsHash(
        entryPath,
        createGetContent(files),
        "/project",
      );

      expect(retriedHash).toBe(freshHash);
    });

    it("recomputes changed files and their dependents after explicit invalidation", async () => {
      const files = new Map<string, string>([
        [
          "/project/pages/index.js",
          `import { helper } from "./helper.ts";\nexport default helper;\n`,
        ],
        ["/project/pages/helper.ts", "export const helper = 'v1';\n"],
      ]);
      const cache = createDependencyHashCache();

      const hash1 = await computeDepsHash(
        "/project/pages/index.js",
        createGetContent(files),
        "/project",
        cache,
      );

      files.set("/project/pages/helper.ts", "export const helper = 'v2';\n");
      const invalidated = invalidateDependencyHashCache(cache, ["/project/pages/helper.ts"]);
      const hash2 = await computeDepsHash(
        "/project/pages/index.js",
        createGetContent(files),
        "/project",
        cache,
      );

      expect(invalidated).toBe(2);
      expect(hash2).not.toBe(hash1);
    });

    it("does not let an in-flight build repopulate invalidated state", async () => {
      const filePath = "/project/pages/index.js";
      const cache = createDependencyHashCache();
      let content = "export const version = 'old';\n";
      let reads = 0;
      let releaseFirstRead!: () => void;
      let markFirstReadStarted!: () => void;
      const firstReadStarted = new Promise<void>((resolve) => {
        markFirstReadStarted = resolve;
      });
      const firstReadRelease = new Promise<void>((resolve) => {
        releaseFirstRead = resolve;
      });

      const getContent = async (): Promise<string> => {
        reads++;
        const captured = content;
        if (reads === 1) {
          markFirstReadStarted();
          await firstReadRelease;
        }
        return captured;
      };

      const inFlightHash = computeDepsHash(filePath, getContent, "/project", cache);
      await firstReadStarted;
      content = "export const version = 'new';\n";
      invalidateDependencyHashCache(cache, [filePath]);
      releaseFirstRead();

      const expectedHash = await computeDepsHash(
        filePath,
        () => Promise.resolve(content),
        "/project",
      );

      expect(await inFlightHash).toBe(expectedHash);
      expect(reads).toBe(2);
    });

    it("retries when invalidation occurs while taking the final hash snapshot", async () => {
      const filePath = "/project/pages/index.js";
      const content = "export const version = 'current';\n";
      const cache = createDependencyHashCache();
      let reads = 0;
      let invalidated = false;
      const getTransitiveDependencies = cache.graph.getTransitiveDependencies.bind(cache.graph);

      cache.graph.getTransitiveDependencies = (path: string): string[] => {
        if (!invalidated) {
          invalidated = true;
          invalidateDependencyHashCache(cache, [filePath]);
        }
        return getTransitiveDependencies(path);
      };

      const actual = await computeDepsHash(
        filePath,
        () => {
          reads++;
          return Promise.resolve(content);
        },
        "/project",
        cache,
      );
      const expected = await computeDepsHash(
        filePath,
        () => Promise.resolve(content),
        "/project",
      );

      expect(actual).toBe(expected);
      expect(reads).toBe(2);
    });

    it("does not deadlock concurrent roots with circular local imports in one cache", async () => {
      const files = new Map<string, string>([
        ["/project/pages/a.js", `import { b } from "./b.js"; export const a = b;`],
        ["/project/pages/b.js", `import { a } from "./a.js"; export const b = a;`],
      ]);
      const reads = new Map<string, number>();
      const cache = createDependencyHashCache();

      const getContent = async (path: string): Promise<string> => {
        reads.set(path, (reads.get(path) ?? 0) + 1);
        await Promise.resolve();
        const content = files.get(path);
        if (content == null) throw new Error(`not found: ${path}`);
        return content;
      };

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const hashes = await Promise.race([
        Promise.all([
          computeDepsHash("/project/pages/a.js", getContent, "/project", cache),
          computeDepsHash("/project/pages/b.js", getContent, "/project", cache),
        ]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("timed out waiting for dependency hashes")),
            100,
          );
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });

      expect(hashes[0]).toBe(hashes[1]);
      expect(reads.get("/project/pages/a.js")).toBe(1);
      expect(reads.get("/project/pages/b.js")).toBe(1);
    });
  });

  describe("computeConfigHash", () => {
    it("should produce different hash for different react version", async () => {
      const hash1 = await computeConfigHash({
        reactVersion: "19.0.0",
        jsxImportSource: "react",
        dev: true,
      });

      const hash2 = await computeConfigHash({
        reactVersion: "19.1.0",
        jsxImportSource: "react",
        dev: true,
      });

      expect(hash1).not.toBe(hash2);
    });

    it("should produce same hash for same config", async () => {
      const config = {
        reactVersion: "19.0.0",
        jsxImportSource: "react",
        dev: true,
        studioEmbed: false,
      };

      const hash1 = await computeConfigHash(config);
      const hash2 = await computeConfigHash(config);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for dev vs production", async () => {
      const hash1 = await computeConfigHash({ dev: true });
      const hash2 = await computeConfigHash({ dev: false });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("buildTransformCacheKey with dependency tracking", () => {
    it("should encode dependency identities into an API-safe key", () => {
      const key = buildTransformCacheKey("file.tsx", "content123", false, false, {
        depsHash: "abcdef0123456789",
        projectId: "proj1",
      });

      expect(key).toMatch(/^[a-zA-Z0-9_:.-]+$/);
      expect(key).toContain("transform:v3:");
      expect(key).not.toContain("abcdef0123456789");
    });

    it("should encode configuration identities into an API-safe key", () => {
      const key = buildTransformCacheKey("file.tsx", "content123", false, false, {
        configHash: "cfg1234567890abc",
        projectId: "proj1",
      });

      expect(key).toMatch(/^[a-zA-Z0-9_:.-]+$/);
      expect(key).not.toContain("cfg1234567890abc");
    });

    it("should produce different keys when depsHash differs", () => {
      const key1 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        depsHash: "same-prefix-1111111111111111-a",
        projectId: "proj1",
      });

      const key2 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        depsHash: "same-prefix-1111111111111111-b",
        projectId: "proj1",
      });

      expect(key1).not.toBe(key2);
    });

    it("should produce different keys when configHash differs", () => {
      const key1 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        configHash: "same-prefix-1111111111111111-a",
        projectId: "proj1",
      });

      const key2 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        configHash: "same-prefix-1111111111111111-b",
        projectId: "proj1",
      });

      expect(key1).not.toBe(key2);
    });

    it("should work without optional dependency identities", () => {
      const key = buildTransformCacheKey("file.tsx", "content123", false, false);

      expect(key).toContain("transform:v3:");
      expect(key).toMatch(/^[a-zA-Z0-9_:.-]+$/);
      expect(key.length).toBeLessThanOrEqual(32 * 1024);
    });

    it("does not alias delimiter-bearing identities or emit unsafe characters", () => {
      const first = buildTransformCacheKey("path:with [brackets].tsx", "hash:one", true, false, {
        projectId: "project:@one",
      });
      const second = buildTransformCacheKey("with [brackets].tsx", "hash:one", true, false, {
        projectId: "project:@one:path",
      });

      expect(first).not.toBe(second);
      expect(first).toMatch(/^[a-zA-Z0-9_:.-]+$/);
      expect(first).not.toContain("@");
      expect(first).not.toContain("[");
    });
  });
});
