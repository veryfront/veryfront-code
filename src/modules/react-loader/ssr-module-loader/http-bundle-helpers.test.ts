import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractAllFilePaths,
  extractHttpBundlePaths,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";

describe("extractHttpBundlePaths", () => {
  it("extracts single HTTP bundle path", () => {
    const code = `import foo from "file:///tmp/.cache/veryfront-http-bundle/http-abcd1234.mjs";`;
    const result = extractHttpBundlePaths(code);
    assertEquals(result.length, 1);
    assertEquals(result[0]!.hash, "abcd1234");
    assertEquals(result[0]!.path, "/tmp/.cache/veryfront-http-bundle/http-abcd1234.mjs");
  });

  it("extracts multiple distinct bundles", () => {
    const code = [
      `import a from "file:///cache/veryfront-http-bundle/http-aaaa1111.mjs";`,
      `import b from "file:///cache/veryfront-http-bundle/http-bbbb2222.mjs";`,
      `import c from "file:///cache/veryfront-http-bundle/http-cccc3333.mjs";`,
    ].join("\n");
    const result = extractHttpBundlePaths(code);
    assertEquals(result.length, 3);
    assertEquals(result.map((r) => r.hash), ["aaaa1111", "bbbb2222", "cccc3333"]);
  });

  it("deduplicates by hash", () => {
    const code = [
      `import a from "file:///cache/veryfront-http-bundle/http-abcd1234.mjs";`,
      `import b from "file:///cache/veryfront-http-bundle/http-abcd1234.mjs";`,
    ].join("\n");
    const result = extractHttpBundlePaths(code);
    assertEquals(result.length, 1);
  });

  it("returns empty array for code with no bundles", () => {
    const code = `import React from "react";\nexport default function App() {}`;
    assertEquals(extractHttpBundlePaths(code).length, 0);
  });

  it("ignores non-HTTP-bundle file:// paths", () => {
    const code = `import comp from "file:///tmp/project/components/Button.js";`;
    assertEquals(extractHttpBundlePaths(code).length, 0);
  });

  it("handles consecutive calls correctly (lastIndex reset)", () => {
    const code = `import x from "file:///cache/veryfront-http-bundle/http-deadbeef.mjs";`;
    const r1 = extractHttpBundlePaths(code);
    const r2 = extractHttpBundlePaths(code);
    assertEquals(r1.length, 1);
    assertEquals(r2.length, 1);
    assertEquals(r1[0]!.hash, r2[0]!.hash);
  });
});

describe("extractAllFilePaths", () => {
  it("extracts .js file paths", () => {
    const code = `import a from "file:///tmp/project/Button.js";`;
    const result = extractAllFilePaths(code);
    assertEquals(result, ["/tmp/project/Button.js"]);
  });

  it("extracts .mjs file paths", () => {
    const code = `import a from "file:///cache/http-abc.mjs";`;
    const result = extractAllFilePaths(code);
    assertEquals(result, ["/cache/http-abc.mjs"]);
  });

  it("extracts mixed .js and .mjs paths", () => {
    const code = [
      `import a from "file:///tmp/a.js";`,
      `import b from "file:///tmp/b.mjs";`,
    ].join("\n");
    const result = extractAllFilePaths(code);
    assertEquals(result.length, 2);
    assertEquals(result.includes("/tmp/a.js"), true);
    assertEquals(result.includes("/tmp/b.mjs"), true);
  });

  it("deduplicates identical paths", () => {
    const code = [
      `import a from "file:///tmp/shared.js";`,
      `import b from "file:///tmp/shared.js";`,
    ].join("\n");
    assertEquals(extractAllFilePaths(code).length, 1);
  });

  it("returns empty for code without file:// paths", () => {
    const code = `import React from "react";\nexport const x = 1;`;
    assertEquals(extractAllFilePaths(code).length, 0);
  });

  it("handles consecutive calls correctly (lastIndex reset)", () => {
    const code = `import x from "file:///tmp/test.js";`;
    const r1 = extractAllFilePaths(code);
    const r2 = extractAllFilePaths(code);
    assertEquals(r1.length, 1);
    assertEquals(r2.length, 1);
  });
});

describe("verifiedHttpBundlePaths", () => {
  it("stores and retrieves verification status", () => {
    verifiedHttpBundlePaths.set("test-key:abc123", true);
    assertEquals(verifiedHttpBundlePaths.get("test-key:abc123"), true);
  });

  it("returns undefined for unknown keys", () => {
    assertEquals(verifiedHttpBundlePaths.get("nonexistent-key"), undefined);
  });
});
