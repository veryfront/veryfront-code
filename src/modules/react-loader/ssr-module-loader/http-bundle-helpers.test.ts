import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractAllFilePaths,
  extractHttpBundlePaths,
  verifiedHttpBundlePaths,
} from "./http-bundle-helpers.ts";

describe("extractHttpBundlePaths", () => {
  // Note: simpleHash() produces decimal numbers (djb2 algorithm), not hex
  it("extracts single HTTP bundle path", () => {
    const code = `import foo from "file:///tmp/.cache/veryfront-http-bundle/http-12345678.mjs";`;
    const [first] = extractHttpBundlePaths(code);

    assertEquals(first?.hash, "12345678");
    assertEquals(
      first?.path,
      "/tmp/.cache/veryfront-http-bundle/http-12345678.mjs",
    );
  });

  it("extracts multiple distinct bundles", () => {
    const code = [
      `import a from "file:///cache/veryfront-http-bundle/http-11111111.mjs";`,
      `import b from "file:///cache/veryfront-http-bundle/http-22222222.mjs";`,
      `import c from "file:///cache/veryfront-http-bundle/http-33333333.mjs";`,
    ].join("\n");

    const result = extractHttpBundlePaths(code);

    assertEquals(result.map((r) => r.hash), ["11111111", "22222222", "33333333"]);
  });

  it("deduplicates by hash", () => {
    const code = [
      `import a from "file:///cache/veryfront-http-bundle/http-12345678.mjs";`,
      `import b from "file:///cache/veryfront-http-bundle/http-12345678.mjs";`,
    ].join("\n");

    assertEquals(extractHttpBundlePaths(code).length, 1);
  });

  it("returns empty array for code with no bundles", () => {
    const code = `import React from "react";\nexport default function App() {}`;
    assertEquals(extractHttpBundlePaths(code), []);
  });

  it("ignores non-HTTP-bundle file:// paths", () => {
    const code = `import comp from "file:///tmp/project/components/Button.js";`;
    assertEquals(extractHttpBundlePaths(code), []);
  });

  it("handles consecutive calls correctly (lastIndex reset)", () => {
    const code = `import x from "file:///cache/veryfront-http-bundle/http-57259823.mjs";`;

    const [r1] = extractHttpBundlePaths(code);
    const [r2] = extractHttpBundlePaths(code);

    assertEquals(r1?.hash, r2?.hash);
  });

  it("extracts relative path imports (portable format)", () => {
    const code = `export * from "./http-691361154.mjs";`;
    const [first] = extractHttpBundlePaths(code);

    assertEquals(first?.hash, "691361154");
    assertEquals(first?.path, "http-691361154.mjs");
  });

  it("extracts mixed absolute and relative paths", () => {
    const code = [
      `import a from "file:///cache/veryfront-http-bundle/http-11111111.mjs";`,
      `export * from "./http-22222222.mjs";`,
      `import b from './http-33333333.mjs';`,
    ].join("\n");

    const result = extractHttpBundlePaths(code);

    assertEquals(result.map((r) => r.hash).sort(), ["11111111", "22222222", "33333333"]);
  });

  it("deduplicates relative paths by hash", () => {
    const code = [
      `export * from "./http-12345678.mjs";`,
      `import x from "./http-12345678.mjs";`,
    ].join("\n");

    assertEquals(extractHttpBundlePaths(code).length, 1);
  });

  it("deduplicates across absolute and relative paths with same hash", () => {
    const code = [
      `import a from "file:///cache/veryfront-http-bundle/http-12345678.mjs";`,
      `export * from "./http-12345678.mjs";`,
    ].join("\n");

    assertEquals(extractHttpBundlePaths(code).length, 1);
  });
});

describe("extractAllFilePaths", () => {
  it("extracts .js file paths", () => {
    const code = `import a from "file:///tmp/project/Button.js";`;
    assertEquals(extractAllFilePaths(code), ["/tmp/project/Button.js"]);
  });

  it("extracts .mjs file paths", () => {
    const code = `import a from "file:///cache/http-abc.mjs";`;
    assertEquals(extractAllFilePaths(code), ["/cache/http-abc.mjs"]);
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
    assertEquals(extractAllFilePaths(code), []);
  });

  it("handles consecutive calls correctly (lastIndex reset)", () => {
    const code = `import x from "file:///tmp/test.js";`;

    assertEquals(extractAllFilePaths(code).length, 1);
    assertEquals(extractAllFilePaths(code).length, 1);
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
