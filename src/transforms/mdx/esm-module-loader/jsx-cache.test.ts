import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/jsx-cache.test */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FRAMEWORK_ROOT } from "./constants.ts";
import { buildMdxJsxCacheFileName } from "./cache-format.ts";
import { transformJsxImports } from "./import-transformer.ts";
import { ensureCachedJsxModulePatched } from "./jsx-cache.ts";
import { getLocalFs } from "./cache/index.ts";

function extractCachedJsxPath(code: string): string {
  const match = code.match(/file:\/\/([^"']+jsx-[^"']+\.mjs)/);
  assertExists(match?.[1]);
  return match[1];
}

describe("ensureCachedJsxModulePatched", () => {
  it("rewrites relative _dnt imports inside cached JSX modules", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-cache-test-" });
    const localFs = getLocalFs();
    const originalWriteTextFile = localFs.writeTextFile.bind(localFs);
    const originalRename = localFs.rename?.bind(localFs);
    if (!originalRename) throw new Error("Test filesystem must support rename");
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];

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
      localFs.writeTextFile = async (path, data) => {
        writes.push(path);
        await originalWriteTextFile(path, data);
      };
      localFs.rename = async (from, to) => {
        renames.push([from, to]);
        await originalRename(from, to);
      };
      const ok = await ensureCachedJsxModulePatched(cachedPath, sourceFilePath);
      assertEquals(ok, true);

      const temporaryWrite = writes.find((path) => path.startsWith(`${cachedPath}.tmp-`));
      assertEquals(typeof temporaryWrite, "string");
      assertEquals(renames, [[temporaryWrite!, cachedPath]]);

      const rewritten = await readTextFile(cachedPath);
      assertEquals(rewritten.includes("../../_dnt.polyfills.js"), false);
      assertEquals(rewritten.includes("../../../_dnt.polyfills.js"), false);
      assertEquals(
        rewritten.includes(`file://${join(FRAMEWORK_ROOT, "_dnt.polyfills.js")}`),
        true,
      );
    } finally {
      localFs.writeTextFile = originalWriteTextFile;
      localFs.rename = originalRename;
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
      await writeTextFile(firstCachedPath, "export const PlatformOverview = () => null;");
      await writeTextFile(secondCachedPath, "export default function PlatformOverview() {}");

      const first = await transformJsxImports(mdxImportCode, adapter, tempDir);
      const firstPath = extractCachedJsxPath(first);

      files.set(sourcePath, secondSource);
      const second = await transformJsxImports(mdxImportCode, adapter, tempDir);
      const secondPath = extractCachedJsxPath(second);

      assertEquals(firstPath, firstCachedPath);
      assertEquals(secondPath, secondCachedPath);
      assertEquals((await readTextFile(secondPath)).includes("default"), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});
