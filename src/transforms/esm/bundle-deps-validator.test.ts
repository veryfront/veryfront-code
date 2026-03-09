import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractBundleDeps } from "./bundle-deps-validator.ts";

describe("transforms/esm/bundle-deps-validator", () => {
  describe("extractBundleDeps", () => {
    it("extracts absolute file:// deps", () => {
      const code = `import "file:///cache/veryfront-http-bundle/http-12345.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "12345");
      assertEquals(deps[0]!.path, "/cache/veryfront-http-bundle/http-12345.mjs");
    });

    it("extracts relative deps", () => {
      const code = `import "./http-67890.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "67890");
      assertEquals(deps[0]!.path, "http-67890.mjs");
    });

    it("extracts mixed absolute and relative deps", () => {
      const code = `
        import "file:///cache/veryfront-http-bundle/http-111.mjs";
        import './http-222.mjs';
      `;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 2);
      const hashes = deps.map((d) => d.hash);
      assertEquals(hashes.includes("111"), true);
      assertEquals(hashes.includes("222"), true);
    });

    it("deduplicates by hash", () => {
      const code = `
        import "file:///cache/veryfront-http-bundle/http-111.mjs";
        import './http-111.mjs';
      `;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "111");
    });

    it("returns empty for code with no deps", () => {
      assertEquals(extractBundleDeps("const x = 1;"), []);
    });

    it("returns empty for empty string", () => {
      assertEquals(extractBundleDeps(""), []);
    });

    it("handles multiple absolute deps", () => {
      const code = `
        import "file:///a/veryfront-http-bundle/http-1.mjs";
        import "file:///a/veryfront-http-bundle/http-2.mjs";
        import "file:///a/veryfront-http-bundle/http-3.mjs";
      `;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 3);
    });

    it("handles double-quoted relative deps", () => {
      const code = `import "./http-99999.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "99999");
    });

    it("extracts deps from from-style imports", () => {
      const code = `import { foo } from "file:///cache/veryfront-http-bundle/http-42.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "42");
    });

    it("handles very large hash numbers", () => {
      const code = `import "file:///cache/veryfront-http-bundle/http-999999999.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "999999999");
    });
  });
});
