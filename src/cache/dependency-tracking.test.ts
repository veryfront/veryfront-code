import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { computeDepsHash } from "./dependency-graph.ts";
import { computeConfigHash } from "./config-hash.ts";
import { buildTransformCacheKey } from "./keys.ts";

describe("Dependency tracking cache invalidation", () => {
  describe("computeDepsHash", () => {
    // Note: normalizeSpecifierToPath converts .ts/.tsx/.jsx → .js for cache key consistency
    // So mock files must use .js extension keys for resolved paths

    it("should produce different hash when dependency content changes", async () => {
      const helperV1 = "export function helper() { return 'v1'; }\n";
      const helperV2 = "export function helper() { return 'v2'; }\n";
      const mainCode =
        `import { helper } from "./helper.ts";\nexport default function() { return helper(); }\n`;

      const files1 = new Map<string, string>([
        ["/project/pages/index.js", mainCode], // entry normalized to .js
        ["/project/pages/helper.js", helperV1], // resolved import normalized to .js
      ]);

      const hash1 = await computeDepsHash(
        "/project/pages/index.js",
        (p) => {
          const c = files1.get(p);
          return c ? Promise.resolve(c) : Promise.reject(new Error(`not found: ${p}`));
        },
        "/project",
      );

      const files2 = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/helper.js", helperV2],
      ]);

      const hash2 = await computeDepsHash(
        "/project/pages/index.js",
        (p) => {
          const c = files2.get(p);
          return c ? Promise.resolve(c) : Promise.reject(new Error(`not found: ${p}`));
        },
        "/project",
      );

      expect(hash1).not.toBe(hash2);
    });

    it("should produce same hash when unrelated file changes", async () => {
      const mainCode =
        `import { helper } from "./helper.ts";\nexport default function() { return helper(); }\n`;
      const helperCode = "export function helper() { return 'stable'; }\n";

      const getContent = (p: string) => {
        const files: Record<string, string> = {
          "/project/pages/index.js": mainCode,
          "/project/pages/helper.js": helperCode,
        };
        const c = files[p];
        return c ? Promise.resolve(c) : Promise.reject(new Error(`not found: ${p}`));
      };

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
        ["/project/pages/formatter.js", formatterCode],
        ["/project/pages/utils.js", utilsV1],
      ]);

      const hash1 = await computeDepsHash(
        "/project/pages/index.js",
        (p) => {
          const c = files1.get(p);
          return c ? Promise.resolve(c) : Promise.reject(new Error(`not found: ${p}`));
        },
        "/project",
      );

      const files2 = new Map<string, string>([
        ["/project/pages/index.js", mainCode],
        ["/project/pages/formatter.js", formatterCode],
        ["/project/pages/utils.js", utilsV2],
      ]);

      const hash2 = await computeDepsHash(
        "/project/pages/index.js",
        (p) => {
          const c = files2.get(p);
          return c ? Promise.resolve(c) : Promise.reject(new Error(`not found: ${p}`));
        },
        "/project",
      );

      expect(hash1).not.toBe(hash2);
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
    it("should include depsHash in cache key when provided", () => {
      const key = buildTransformCacheKey("file.tsx", "content123", false, false, {
        depsHash: "abcdef0123456789",
        projectId: "proj1",
      });

      expect(key).toContain("deps=abcdef01");
    });

    it("should include configHash in cache key when provided", () => {
      const key = buildTransformCacheKey("file.tsx", "content123", false, false, {
        configHash: "cfg1234567890abc",
        projectId: "proj1",
      });

      expect(key).toContain("cfg=cfg12345");
    });

    it("should produce different keys when depsHash differs", () => {
      const key1 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        depsHash: "aaaa1111bbbb2222",
        projectId: "proj1",
      });

      const key2 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        depsHash: "cccc3333dddd4444",
        projectId: "proj1",
      });

      expect(key1).not.toBe(key2);
    });

    it("should produce different keys when configHash differs", () => {
      const key1 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        configHash: "aaaa1111bbbb2222",
        projectId: "proj1",
      });

      const key2 = buildTransformCacheKey("file.tsx", "content123", false, false, {
        configHash: "cccc3333dddd4444",
        projectId: "proj1",
      });

      expect(key1).not.toBe(key2);
    });

    it("should work without dependency tracking (backward compatible)", () => {
      const key = buildTransformCacheKey("file.tsx", "content123", false, false);

      expect(key).not.toContain("deps=");
      expect(key).not.toContain("cfg=");
      expect(key).toContain("file.tsx");
      expect(key).toContain("content123");
    });
  });
});
