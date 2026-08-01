import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  extractAllFilePaths,
  extractAllFilePathsRecursive,
  extractAllHttpBundlePathsRecursive,
  extractHttpBundlePaths,
  verifiedHttpBundlePaths,
  visitImportedVfModules,
} from "./http-bundle-helpers.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";

describe("extractHttpBundlePaths", () => {
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

  it("extracts full SHA-256 bundle hashes", () => {
    const hash = "d9daafa3b706faf7af89c03417596d23beed4c1ae964d7ee7ead5d335b683412";
    const code = [
      `import value from "file:///cache/veryfront-http-bundle/http-${hash}.mjs";`,
      `export * from "./http-${hash}.mjs";`,
    ].join("\n");

    assertEquals(extractHttpBundlePaths(code), [{
      path: `/cache/veryfront-http-bundle/http-${hash}.mjs`,
      hash,
    }]);
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

  it("extracts legacy .tsx cache paths", () => {
    const code = `import a from "file:///app/.cache/markdown.tsx";`;
    assertEquals(extractAllFilePaths(code), ["/app/.cache/markdown.tsx"]);
  });

  it("preserves compiled framework .src cache paths", () => {
    const code = [
      `import context from "file:///tmp/deno-compile-veryfront/dist/framework-src/react/context/index.tsx.src";`,
      `import core from "file:///tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src?v=42";`,
    ].join("\n");

    assertEquals(extractAllFilePaths(code), [
      "/tmp/deno-compile-veryfront/dist/framework-src/react/context/index.tsx.src",
      "/tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src",
    ]);
  });

  it("does not truncate unsupported file URL suffixes into valid-looking paths", () => {
    const code = [
      `import source from "file:///tmp/project/Button.ts.source";`,
      `import sourceMap from "file:///tmp/project/Button.js.map";`,
    ].join("\n");

    assertEquals(extractAllFilePaths(code), []);
  });

  it("ignores file URLs with a host component", () => {
    const code = `import remote from "file://cache-host/tmp/project/Button.js";`;

    assertEquals(extractAllFilePaths(code), []);
  });

  it("strips query parameters from extracted paths", () => {
    const code = `import a from "file:///tmp/project/Button.tsx?v=123";`;
    assertEquals(extractAllFilePaths(code), ["/tmp/project/Button.tsx"]);
  });

  it("decodes encoded file URL paths before filesystem validation", () => {
    const path = "/tmp/_pins/on%3Asnapshot/Button.tsx";
    const code = `import a from ${JSON.stringify(toFileUrl(path).href)};`;

    assertEquals(extractAllFilePaths(code), [path]);
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

describe("recursive cache path extraction", () => {
  it("extracts HTTP bundles from nested vf modules", async () => {
    const tempDir = join(
      getMdxEsmCacheDir(),
      `vf-http-bundle-helper-${crypto.randomUUID()}`,
    );
    const vfmodDir = join(tempDir, "veryfront-mdx-esm", "project-a", "preview-main");
    const childPath = join(vfmodDir, "vfmod-child.mjs");
    const grandChildPath = join(vfmodDir, "vfmod-grandchild.mjs");

    try {
      await mkdir(vfmodDir, { recursive: true });
      await writeTextFile(
        childPath,
        [
          `export * from "./http-11111111.mjs";`,
          `import nested from "file://${grandChildPath}";`,
          `export default nested;`,
        ].join("\n"),
      );
      await writeTextFile(grandChildPath, `export * from "./http-22222222.mjs";`);

      const bundles = await extractAllHttpBundlePathsRecursive(
        `import child from "file://${childPath}"; export default child;`,
      );

      assertEquals(bundles.map((bundle) => bundle.hash).sort(), ["11111111", "22222222"]);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("extracts nested legacy file dependencies through vf modules", async () => {
    const tempDir = join(
      getMdxEsmCacheDir(),
      `vf-file-path-helper-${crypto.randomUUID()}`,
    );
    const vfmodDir = join(tempDir, "veryfront-mdx-esm", "project-a", "preview-main");
    const childPath = join(vfmodDir, "vfmod-child.mjs");

    try {
      await mkdir(vfmodDir, { recursive: true });
      await writeTextFile(
        childPath,
        `import markdown from "file:///app/.cache/markdown.tsx"; export default markdown;`,
      );

      const paths = await extractAllFilePathsRecursive(
        `import child from "file://${childPath}"; export default child;`,
      );

      assertEquals(paths.includes(childPath), true);
      assertEquals(paths.includes("/app/.cache/markdown.tsx"), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not read import-looking strings or modules outside the VF cache root", async () => {
    const outsideDir = await makeTempDir({
      prefix: "vf-http-bundle-outside-cache-",
    });
    const outsideModuleDir = join(outsideDir, "veryfront-mdx-esm");
    const outsideModulePath = join(outsideModuleDir, "secret.mjs");

    try {
      await mkdir(outsideModuleDir, { recursive: true });
      await writeTextFile(
        outsideModulePath,
        `export const secret = "must not be read";`,
      );
      let visits = 0;

      await visitImportedVfModules(
        [
          `const text = 'import x from "file://${outsideModulePath}"';`,
          `import outside from "file://${outsideModulePath}";`,
          `void outside;`,
        ].join("\n"),
        () => {
          visits++;
        },
      );

      assertEquals(visits, 0);
    } finally {
      await remove(outsideDir, { recursive: true });
    }
  });

  it("visits nested modules through encoded file URL paths", async () => {
    const tempDir = join(
      getMdxEsmCacheDir(),
      `vf-encoded-file-path-helper-${crypto.randomUUID()}`,
    );
    const childDir = join(tempDir, "veryfront-mdx-esm", "_pins", "on%3Asnapshot");
    const childPath = join(childDir, "vfmod-child.mjs");

    try {
      await mkdir(childDir, { recursive: true });
      await writeTextFile(
        childPath,
        `import markdown from "file:///app/.cache/markdown.tsx"; export default markdown;`,
      );

      const paths = await extractAllFilePathsRecursive(
        `import child from ${JSON.stringify(toFileUrl(childPath).href)}; export default child;`,
      );

      assertEquals(paths.includes(childPath), true);
      assertEquals(paths.includes("/app/.cache/markdown.tsx"), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});
