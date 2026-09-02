import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/jsx-cache.test */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FRAMEWORK_ROOT } from "./constants.ts";
import { buildMdxJsxCacheFileName, buildMdxJsxCacheFileNamePrefix } from "./cache-format.ts";
import { transformJsxImports } from "./import-transformer.ts";
import { ensureCachedJsxModulePatched } from "./jsx-cache.ts";
import { MAX_MDX_MODULE_CODE_BYTES, ModuleSourceLimitError } from "./module-fetcher/limits.ts";

function extractCachedJsxPath(code: string): string {
  const match = code.match(/file:\/\/([^"']+jsx-[^"']+\.mjs)/);
  assertExists(match?.[1]);
  return match[1];
}

describe("ensureCachedJsxModulePatched", () => {
  it("rewrites relative _dnt imports inside cached JSX modules", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-cache-test-" });

    try {
      const badCode = [
        `import "../../../_dnt.polyfills.js";`,
        `export const value = 1;`,
      ].join("\n");
      const cachedPath = join(tempDir, buildMdxJsxCacheFileName("/tmp/source/Head.tsx", badCode));
      await writeTextFile(cachedPath, badCode);

      const sourceFilePath = join(
        FRAMEWORK_ROOT,
        "src",
        "react",
        "components",
        "Head.tsx",
      );
      const ok = await ensureCachedJsxModulePatched(cachedPath, sourceFilePath);
      assertEquals(ok, true);

      const rewritten = await readTextFile(cachedPath);
      assertEquals(rewritten.includes("../../_dnt.polyfills.js"), false);
      assertEquals(rewritten.includes("../../../_dnt.polyfills.js"), false);
      assertEquals(
        rewritten.includes(`file://${join(FRAMEWORK_ROOT, "_dnt.polyfills.js")}`),
        true,
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not re-read a cached module it already normalized in this process", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-cache-memo-test-" });

    try {
      // The cache file name is derived from the source path and its full
      // contents, so a normalized path can never later describe other source.
      const cachedCode = `export const value = 1;\n`;
      const cachedPath = join(
        tempDir,
        buildMdxJsxCacheFileName("/tmp/source/Value.tsx", cachedCode),
      );
      await writeTextFile(cachedPath, cachedCode);

      assertEquals(await ensureCachedJsxModulePatched(cachedPath, "/tmp/source/Value.tsx"), true);

      // Removing the artifact makes any second read observable: a re-reading
      // implementation reports the module as needing regeneration.
      await remove(cachedPath);
      assertEquals(
        await ensureCachedJsxModulePatched(cachedPath, "/tmp/source/Value.tsx"),
        true,
        "an already normalized cached module must not be re-read on every cache hit",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reports an unreadable cached module as needing regeneration", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-cache-missing-test-" });

    try {
      const sourceFilePath = join(
        FRAMEWORK_ROOT,
        "src",
        "react",
        "components",
        "Head.tsx",
      );
      assertEquals(
        await ensureCachedJsxModulePatched(join(tempDir, "missing-jsx.mjs"), sourceFilePath),
        false,
        "unreadable cached module must be regenerated",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("transformJsxImports", () => {
  it("uses a distinct cached JSX module when source content changes at the same path", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-content-cache-test-" });
    const sourcePath = "/tmp/source/PlatformOverview.tsx";
    const firstSource = "export const PlatformOverview = () => <svg />;";
    const secondSource = "export default function PlatformOverview() { return <svg />; }";
    const files = new Map<string, string>([
      [
        sourcePath,
        firstSource,
      ],
    ]);
    const adapter = {
      fs: {
        readFile: (path: string) => {
          const source = files.get(path);
          if (source === undefined) throw new Error(`unexpected read: ${path}`);
          return Promise.resolve(source);
        },
      },
    } as unknown as RuntimeAdapter;
    const mdxImportCode = `import PlatformOverview from "file://${sourcePath}";`;

    try {
      const firstCachedPath = join(tempDir, buildMdxJsxCacheFileName(sourcePath, firstSource));
      const secondCachedPath = join(tempDir, buildMdxJsxCacheFileName(sourcePath, secondSource));
      assertNotEquals(
        firstCachedPath,
        secondCachedPath,
        "a source-content change must produce a distinct cache file name",
      );
      await writeTextFile(firstCachedPath, "export const PlatformOverview = () => null;");
      await writeTextFile(secondCachedPath, "export default function PlatformOverview() {}");

      const first = await transformJsxImports(mdxImportCode, adapter, tempDir);
      const firstPath = extractCachedJsxPath(first);

      files.set(sourcePath, secondSource);
      const second = await transformJsxImports(mdxImportCode, adapter, tempDir);
      const secondPath = extractCachedJsxPath(second);

      assertNotEquals(
        firstPath,
        secondPath,
        "the transform must select a distinct cached module after the source changed",
      );
      assertEquals(firstPath, firstCachedPath);
      assertEquals(secondPath, secondCachedPath);
      assertEquals(
        (await readTextFile(firstPath)).includes("default"),
        false,
        "the first cached module must not be overwritten by the second",
      );
      assertEquals((await readTextFile(secondPath)).includes("default"), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("rejects a project JSX source larger than the module source limit", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-oversized-source-test-" });
    const sourcePath = "/tmp/source/Oversized.tsx";
    const oversizedSource = `export const pad = "${"a".repeat(MAX_MDX_MODULE_CODE_BYTES)}";`;
    let readCount = 0;
    const adapter = {
      fs: {
        readFile: (path: string) => {
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          readCount += 1;
          return Promise.resolve(oversizedSource);
        },
      },
    } as unknown as RuntimeAdapter;
    const mdxImportCode = `import Oversized from "file://${sourcePath}";`;

    try {
      await assertRejects(
        () => transformJsxImports(mdxImportCode, adapter, tempDir),
        ModuleSourceLimitError,
        sourcePath,
      );
      assertEquals(readCount, 1, "an oversized source must be rejected, not retried");

      const written: string[] = [];
      for await (const entry of readDir(tempDir)) written.push(entry.name);
      assertEquals(
        written,
        [],
        "an oversized source must not leave a cached artifact behind",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("removes the superseded cached artifacts of a changed source path", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-artifact-prune-test-" });
    const sourcePath = "/tmp/source/Changing.tsx";
    const firstSource = "export const Changing = () => <b />;";
    const secondSource = "export const Changing = () => <i />;";
    let source = firstSource;
    const adapter = {
      fs: {
        readFile: (path: string) => {
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          return Promise.resolve(source);
        },
      },
    } as unknown as RuntimeAdapter;
    const mdxImportCode = `import Changing from "file://${sourcePath}";`;

    try {
      const firstPath = extractCachedJsxPath(
        await transformJsxImports(mdxImportCode, adapter, tempDir),
      );

      source = secondSource;
      const secondPath = extractCachedJsxPath(
        await transformJsxImports(mdxImportCode, adapter, tempDir),
      );
      assertNotEquals(firstPath, secondPath);

      // Every content variant of one source path shares a name prefix, so the
      // writer can drop the superseded ones instead of letting each variant
      // leave a persistent artifact in the shared cache directory.
      const prefix = buildMdxJsxCacheFileNamePrefix(sourcePath);
      const remaining: string[] = [];
      for await (const entry of readDir(tempDir)) {
        if (entry.name.startsWith(prefix)) remaining.push(entry.name);
      }
      assertEquals(
        remaining.length,
        1,
        "only the newest cached artifact for the source path may survive",
      );
      assertEquals(join(tempDir, remaining[0]), secondPath);
    } finally {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });
});
