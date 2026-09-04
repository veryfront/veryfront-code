import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/jsx-cache.test */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createFileSystem,
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FRAMEWORK_ROOT } from "./constants.ts";
import {
  buildMdxJsxCacheFileName,
  buildMdxJsxCacheFileNamePrefix,
  MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH,
  MDX_JSX_CACHE_NAMESPACE_PREFIX,
} from "./cache-format.ts";
import { __importTransformerInternals, transformJsxImports } from "./import-transformer.ts";
import {
  __jsxCacheInternals,
  ensureCachedJsxModulePatched,
  ensureJsxCacheSweepArmed,
  JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
  JSX_CACHE_VARIANT_MIN_AGE_MS,
  markJsxArtifactServed,
  MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY,
  MAX_JSX_CACHE_VARIANTS_PER_PATH,
  pruneSupersededJsxArtifacts,
  refreshJsxArtifactMtime,
  retainJsxArtifactsReferencedIn,
  withJsxArtifactLock,
  withJsxArtifactWriteCapacity,
} from "./jsx-cache.ts";
import { MAX_MDX_MODULE_CODE_BYTES, ModuleSourceLimitError } from "./module-fetcher/limits.ts";
import { getLocalFs } from "./cache/index.ts";

function limitErrorMessage(error: unknown): string {
  if (!(error instanceof ModuleSourceLimitError)) {
    throw new Error(`expected a ModuleSourceLimitError, got ${String(error)}`);
  }
  return error.message;
}

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

      const sourceFilePath = join(FRAMEWORK_ROOT, "src", "react", "components", "Value.tsx");
      assertEquals(await ensureCachedJsxModulePatched(cachedPath, sourceFilePath), true);

      // Content a re-reading implementation would rewrite makes the second read
      // observable: if the memo is honoured the file is left exactly as written.
      const wouldBeRewritten = `import "../../../_dnt.polyfills.js";\nexport const value = 1;\n`;
      await writeTextFile(cachedPath, wouldBeRewritten);

      assertEquals(await ensureCachedJsxModulePatched(cachedPath, sourceFilePath), true);
      assertEquals(
        await readTextFile(cachedPath),
        wouldBeRewritten,
        "an already normalized cached module must not be re-read on every cache hit",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reports a memoized module that has since been pruned as needing regeneration", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-cache-memo-pruned-test-" });

    try {
      const cachedCode = `export const pruned = 1;\n`;
      const cachedPath = join(
        tempDir,
        buildMdxJsxCacheFileName("/tmp/source/Pruned.tsx", cachedCode),
      );
      await writeTextFile(cachedPath, cachedCode);
      assertEquals(await ensureCachedJsxModulePatched(cachedPath, "/tmp/source/Pruned.tsx"), true);

      // A prune between the caller's stat and this call must not leave the
      // rewritten parent importing a `file://` module that is no longer there.
      await remove(cachedPath);
      assertEquals(
        await ensureCachedJsxModulePatched(cachedPath, "/tmp/source/Pruned.tsx"),
        false,
        "a memo hit for a removed artifact must report regeneration, not reuse",
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
  afterEach(() => {
    // Every prune pass now arms an unref'd follow-up timer (idle collection
    // never depends on a future write); drop it so no test observes a
    // neighbour's pending cleanup.
    __jsxCacheInternals.cancelScheduledJsxCachePrunes();
  });

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

  it("arms the age-based sweep even when a render is served entirely from cache", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-sweep-armed-test-" });
    const sourcePath = "/tmp/source/AllCached.tsx";
    const source = "export const AllCached = () => <b />;";
    const adapter = {
      fs: {
        readFile: (path: string) => {
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          return Promise.resolve(source);
        },
      },
    } as unknown as RuntimeAdapter;

    try {
      const cachedPath = join(tempDir, buildMdxJsxCacheFileName(sourcePath, source));
      await writeTextFile(
        cachedPath,
        "import React from 'react';\nexport const AllCached = () => null;",
      );

      const transformed = await transformJsxImports(
        `import AllCached from "file://${sourcePath}";`,
        adapter,
        tempDir,
      );

      // Served entirely from cache: no artifact written, so no write-driven
      // prune ever runs. A replacement process after a restart must still get
      // the scan that collects variants retired before it booted.
      assertEquals(extractCachedJsxPath(transformed), cachedPath);
      assertEquals(
        __jsxCacheInternals.hasScheduledJsxCachePrune(tempDir),
        true,
        "a cached-only render must re-arm the sweep a process restart lost",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("rejects a project JSX source larger than the module source limit", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-oversized-source-test-" });
    const projectDir = "/srv/deployments/tenant-42/project";
    const sourcePath = `${projectDir}/components/Oversized.tsx`;
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
      const error = await assertRejects(
        () => transformJsxImports(mdxImportCode, adapter, tempDir, projectDir),
        ModuleSourceLimitError,
        "components/Oversized.tsx",
      );
      assertEquals(
        limitErrorMessage(error).includes(projectDir),
        false,
        "the limit error must not disclose the deployment path above the project root",
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

  it("lets sibling imports settle before an oversized source rejects the transform", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-oversized-sibling-test-" });
    const oversizedPath = "/tmp/source/TooBig.tsx";
    const siblingPath = "/tmp/source/Sibling.tsx";
    const siblingSource = "export const Sibling = () => <em />;";
    const adapter = {
      fs: {
        readFile: (path: string) => {
          if (path === siblingPath) return Promise.resolve(siblingSource);
          if (path !== oversizedPath) throw new Error(`unexpected read: ${path}`);
          return Promise.resolve(`export const pad = "${"a".repeat(MAX_MDX_MODULE_CODE_BYTES)}";`);
        },
      },
    } as unknown as RuntimeAdapter;

    try {
      await assertRejects(
        () =>
          transformJsxImports(
            [
              `import TooBig from "file://${oversizedPath}";`,
              `import Sibling from "file://${siblingPath}";`,
            ].join("\n"),
            adapter,
            tempDir,
          ),
        ModuleSourceLimitError,
        "TooBig.tsx",
      );

      // The admission failure must not return before the siblings that kept
      // running have finished writing, or their artifacts outlive every
      // cleanup pass.
      const siblingArtifact = join(tempDir, buildMdxJsxCacheFileName(siblingPath, siblingSource));
      assertEquals(
        (await readTextFile(siblingArtifact)).length > 0,
        true,
        "a sibling that finished writing must be observable once the error surfaces",
      );
    } finally {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });

  it("names only the file when the source sits outside the project directory", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-oversized-outside-test-" });
    const sourcePath = "/var/lib/veryfront/linked/Outside.tsx";
    const oversizedSource = `export const pad = "${"a".repeat(MAX_MDX_MODULE_CODE_BYTES)}";`;
    const adapter = {
      fs: {
        readFile: () => Promise.resolve(oversizedSource),
      },
    } as unknown as RuntimeAdapter;

    try {
      const error = await assertRejects(
        () =>
          transformJsxImports(
            `import Outside from "file://${sourcePath}";`,
            adapter,
            tempDir,
            "/srv/deployments/tenant-42/project",
          ),
        ModuleSourceLimitError,
        "Outside.tsx",
      );
      assertEquals(
        limitErrorMessage(error).includes("/var/lib/veryfront"),
        false,
        "a source outside the project must be named without its filesystem location",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reads a project JSX source through the adapter's strict bounded reader", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-strict-reader-test-" });
    const sourcePath = "/tmp/source/Strict.tsx";
    const source = "export const Strict = () => <b />;";
    const requestedLimits: number[] = [];
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("unbounded readFile must not be used when a strict reader exists");
        },
        readFileBytesWithinLimit: (path: string, byteLimit: number) => {
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          requestedLimits.push(byteLimit);
          return Promise.resolve(new TextEncoder().encode(source));
        },
      },
    } as unknown as RuntimeAdapter;

    try {
      const transformed = await transformJsxImports(
        `import Strict from "file://${sourcePath}";`,
        adapter,
        tempDir,
      );
      assertEquals(extractCachedJsxPath(transformed).startsWith(tempDir), true);
      assertEquals(
        requestedLimits,
        [MAX_MDX_MODULE_CODE_BYTES],
        "the strict reader must be asked for exactly the accepted maximum",
      );
    } finally {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });

  it("translates a strict bounded reader's oversize rejection into a limit error", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-strict-oversize-test-" });
    const projectDir = "/srv/deployments/tenant-42/project";
    const sourcePath = `${projectDir}/components/Huge.tsx`;
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("unbounded readFile must not be used when a strict reader exists");
        },
        readFileBytesWithinLimit: () =>
          Promise.reject(new RangeError("value exceeds the requested byte limit")),
      },
    } as unknown as RuntimeAdapter;

    try {
      const error = await assertRejects(
        () =>
          transformJsxImports(
            `import Huge from "file://${sourcePath}";`,
            adapter,
            tempDir,
            projectDir,
          ),
        ModuleSourceLimitError,
        "components/Huge.tsx",
      );
      assertEquals(
        limitErrorMessage(error).includes(`max ${MAX_MDX_MODULE_CODE_BYTES} bytes`),
        true,
        "a reader that refuses to measure an oversized source must still report the ceiling",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps every freshly written variant of a changing source path", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-artifact-fresh-test-" });
    const sourcePath = "/tmp/source/Changing.tsx";
    const otherPath = "/tmp/source/Stable.tsx";
    let variant = 0;
    const adapter = {
      fs: {
        readFile: (path: string) => {
          if (path === otherPath) return Promise.resolve("export const Stable = () => <hr />;");
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          return Promise.resolve(`export const Changing = () => <b data-v="${variant}" />;`);
        },
      },
    } as unknown as RuntimeAdapter;
    const mdxImportCode = `import Changing from "file://${sourcePath}";`;

    try {
      const otherArtifact = extractCachedJsxPath(
        await transformJsxImports(
          `import Stable from "file://${otherPath}";`,
          adapter,
          tempDir,
        ),
      );

      const writtenPaths: string[] = [];
      for (; variant < 4; variant++) {
        writtenPaths.push(
          extractCachedJsxPath(await transformJsxImports(mdxImportCode, adapter, tempDir)),
        );
      }
      assertEquals(
        new Set(writtenPaths).size,
        writtenPaths.length,
        "each source content variant must occupy its own cache artifact",
      );

      // Nothing a render has just returned may be retired, whatever the order
      // the writes landed in: the grace period is what makes that true.
      for (const writtenPath of writtenPaths) {
        assertEquals(
          (await readTextFile(writtenPath)).length > 0,
          true,
          "a freshly written artifact must survive the prune pass that followed it",
        );
      }
      assertEquals(
        (await readTextFile(otherArtifact)).length > 0,
        true,
        "pruning one source path must not touch another path's artifact",
      );
    } finally {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps the artifacts of concurrent renders of one changing source path", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-concurrent-prune-test-" });
    const sourcePath = "/tmp/source/Concurrent.tsx";
    const generations = ["<b />", "<i />", "<u />", "<s />"];
    let generation = 0;
    const adapter = {
      fs: {
        readFile: (path: string) => {
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          // Each concurrent render observes its own generation of the source,
          // the interleaving a preview deploy produces while it is updating.
          const source = `export const Concurrent = () => ${generations[generation]};`;
          generation = (generation + 1) % generations.length;
          return Promise.resolve(source);
        },
      },
    } as unknown as RuntimeAdapter;
    const mdxImportCode = `import Concurrent from "file://${sourcePath}";`;

    try {
      const rendered = await Promise.all(
        generations.map(() => transformJsxImports(mdxImportCode, adapter, tempDir)),
      );
      const servedPaths = rendered.map(extractCachedJsxPath);
      assertEquals(
        new Set(servedPaths).size,
        generations.length,
        "each concurrent render must serve its own content variant",
      );

      for (const servedPath of servedPaths) {
        assertEquals(
          (await readTextFile(servedPath)).length > 0,
          true,
          "an artifact a concurrent render returned must still exist after pruning",
        );
      }
    } finally {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("readProjectJsxSourceWithinLimit", () => {
  afterEach(() => {
    // Every transform arms the directory's unref'd sweep timer; drop it so no
    // test observes a neighbour's pending cleanup.
    __jsxCacheInternals.cancelScheduledJsxCachePrunes();
  });

  it("falls back to the prefix reader when no strict reader is advertised", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prefix-reader-test-" });
    const sourcePath = "/tmp/source/Prefix.tsx";
    const source = "export const Prefix = () => <b />;";
    const requestedLimits: number[] = [];
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("unbounded readFile must not be used when a bounded reader exists");
        },
        readFileBytesBounded: (path: string, byteLimit: number) => {
          if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
          requestedLimits.push(byteLimit);
          return Promise.resolve(new TextEncoder().encode(source));
        },
      },
    } as unknown as RuntimeAdapter;

    try {
      const transformed = await transformJsxImports(
        `import Prefix from "file://${sourcePath}";`,
        adapter,
        tempDir,
      );
      assertEquals(extractCachedJsxPath(transformed).startsWith(tempDir), true);
      assertEquals(
        requestedLimits,
        [MAX_MDX_MODULE_CODE_BYTES + 1],
        "the prefix reader must be asked for one byte past the ceiling to see an overrun",
      );
    } finally {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });

  it("refuses a strict reader that returns more bytes than the limit it was given", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-strict-overrun-test-" });
    const projectDir = "/srv/deployments/tenant-42/project";
    const sourcePath = `${projectDir}/components/Overrun.tsx`;
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("unbounded readFile must not be used when a strict reader exists");
        },
        // A reader that ignores its ceiling is the case the shared bounded
        // reader re-checks for: without the length check on the returned
        // bytes, the strict branch every production adapter takes would admit
        // the payload the limit exists to refuse.
        readFileBytesWithinLimit: (_path: string, byteLimit: number) =>
          Promise.resolve(new Uint8Array(byteLimit + 1)),
      },
    } as unknown as RuntimeAdapter;

    try {
      await assertRejects(
        () =>
          transformJsxImports(
            `import Overrun from "file://${sourcePath}";`,
            adapter,
            tempDir,
            projectDir,
          ),
        ModuleSourceLimitError,
        "components/Overrun.tsx",
      );

      const written: string[] = [];
      for await (const entry of readDir(tempDir)) written.push(entry.name);
      assertEquals(written, [], "a refused source must not leave a cached artifact behind");
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("propagates a bounded read failure that is not an oversize rejection", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-strict-failure-test-" });
    const sourcePath = "/tmp/source/Unreadable.tsx";
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("unbounded readFile must not be used when a strict reader exists");
        },
        readFileBytesWithinLimit: () => Promise.reject(new Error("permission denied")),
      },
    } as unknown as RuntimeAdapter;

    try {
      // A source that cannot be read is a transform failure, not an admission
      // failure: the import is left alone rather than failing the whole render.
      const transformed = await transformJsxImports(
        `import Unreadable from "file://${sourcePath}";`,
        adapter,
        tempDir,
      );
      assertEquals(transformed.includes(`file://${sourcePath}`), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("rejects an oversized source read through the prefix reader", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prefix-oversize-test-" });
    const projectDir = "/srv/deployments/tenant-42/project";
    const sourcePath = `${projectDir}/components/Prefix.tsx`;
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("unbounded readFile must not be used when a bounded reader exists");
        },
        readFileBytesBounded: (_path: string, byteLimit: number) =>
          Promise.resolve(new Uint8Array(byteLimit)),
      },
    } as unknown as RuntimeAdapter;

    try {
      const error = await assertRejects(
        () =>
          transformJsxImports(
            `import Prefix from "file://${sourcePath}";`,
            adapter,
            tempDir,
            projectDir,
          ),
        ModuleSourceLimitError,
        "components/Prefix.tsx",
      );
      assertEquals(
        limitErrorMessage(error).includes(`${MAX_MDX_MODULE_CODE_BYTES + 1} bytes`),
        true,
        "the prefix reader knows the overrun size and must report it",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("pruneSupersededJsxArtifacts", () => {
  const {
    cancelScheduledJsxCachePrunes,
    collectExcessJsxArtifacts,
    hasScheduledJsxCachePrune,
    readArtifactModifiedAtMs,
    releaseJsxArtifact,
    removeJsxArtifactUnlessServed,
    retainJsxArtifact,
  } = __jsxCacheInternals;

  afterEach(() => {
    // A pass that leaves protected variants behind arms an unref'd follow-up
    // timer; drop it so no test observes a neighbour's pending cleanup.
    cancelScheduledJsxCachePrunes();
  });

  /** A clock far enough ahead that every artifact written now is prunable. */
  function afterGracePeriod(): number {
    return Date.now() + JSX_CACHE_VARIANT_MIN_AGE_MS + 60_000;
  }

  async function writeVariants(
    dir: string,
    sourcePath: string,
    count: number,
  ): Promise<string[]> {
    const names: string[] = [];
    for (let variant = 0; variant < count; variant++) {
      const name = buildMdxJsxCacheFileName(sourcePath, `export const v = ${variant};`);
      await writeTextFile(join(dir, name), `export const v = ${variant};`);
      names.push(name);
    }
    return names;
  }

  async function namesWithPrefix(dir: string, prefix: string): Promise<string[]> {
    const found: string[] = [];
    for await (const entry of readDir(dir)) {
      if (entry.isFile && entry.name.startsWith(prefix)) found.push(entry.name);
    }
    return found;
  }

  it("treats an artifact that vanished before its stat as the oldest variant", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-vanished-test-" });

    try {
      assertEquals(await readArtifactModifiedAtMs(join(tempDir, "gone.mjs")), 0);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("retires the oldest variants once a path exceeds the retention window", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-unit-test-" });
    const sourcePath = "/tmp/source/Many.tsx";
    const prefix = buildMdxJsxCacheFileNamePrefix(sourcePath);

    try {
      const names = await writeVariants(tempDir, sourcePath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 4);
      const current = names[names.length - 1] ?? "";

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, current]]),
        afterGracePeriod(),
      );

      const remaining = await namesWithPrefix(tempDir, prefix);
      assertEquals(remaining.length, MAX_JSX_CACHE_VARIANTS_PER_PATH);
      assertEquals(
        remaining.includes(current),
        true,
        "the artifact the caller just wrote must never be retired",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("never retires an artifact younger than the grace period", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-grace-test-" });
    const sourcePath = "/tmp/source/Busy.tsx";
    const prefix = buildMdxJsxCacheFileNamePrefix(sourcePath);
    const overWindow = MAX_JSX_CACHE_VARIANTS_PER_PATH + 4;

    try {
      const names = await writeVariants(tempDir, sourcePath, overWindow);

      // More variants than the window, but every one of them could still be the
      // artifact an in-flight render is about to import, so none may be removed.
      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
      );

      assertEquals(
        (await namesWithPrefix(tempDir, prefix)).length,
        overWindow,
        "concurrency above the retention window must not cost a live artifact",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("leaves a path alone while it stays inside the retention window", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-window-test-" });
    const sourcePath = "/tmp/source/Few.tsx";

    try {
      const names = await writeVariants(tempDir, sourcePath, MAX_JSX_CACHE_VARIANTS_PER_PATH);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
        afterGracePeriod(),
      );

      const remaining: string[] = [];
      for await (const entry of readDir(tempDir)) remaining.push(entry.name);
      assertEquals(remaining.length, MAX_JSX_CACHE_VARIANTS_PER_PATH);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("ignores directory entries that share an artifact prefix", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-dir-entry-test-" });
    const sourcePath = "/tmp/source/DirEntry.tsx";
    const prefix = buildMdxJsxCacheFileNamePrefix(sourcePath);

    try {
      await mkdir(join(tempDir, `${prefix}directory`));
      const names = await writeVariants(tempDir, sourcePath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 2);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
        afterGracePeriod(),
      );

      const remainingFiles: string[] = [];
      let keptDirectory = false;
      for await (const entry of readDir(tempDir)) {
        if (entry.isDirectory) keptDirectory = true;
        else remainingFiles.push(entry.name);
      }
      assertEquals(remainingFiles.length, MAX_JSX_CACHE_VARIANTS_PER_PATH);
      assertEquals(keptDirectory, true, "a directory is never an artifact to retire");
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("retires variants for several written paths in one scan", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-multi-test-" });
    const firstPath = "/tmp/source/First.tsx";
    const secondPath = "/tmp/source/Second.tsx";

    try {
      const first = await writeVariants(tempDir, firstPath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 3);
      const second = await writeVariants(tempDir, secondPath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 5);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([
          [firstPath, first[first.length - 1] ?? ""],
          [secondPath, second[second.length - 1] ?? ""],
        ]),
        afterGracePeriod(),
      );

      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(firstPath))).length,
        MAX_JSX_CACHE_VARIANTS_PER_PATH,
      );
      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(secondPath))).length,
        MAX_JSX_CACHE_VARIANTS_PER_PATH,
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("retires a path the caller did not write, so a change burst cannot linger", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-untouched-test-" });
    const burstPath = "/tmp/source/Burst.tsx";
    const writtenPath = "/tmp/source/Written.tsx";

    try {
      await writeVariants(tempDir, burstPath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 6);
      const written = await writeVariants(tempDir, writtenPath, 1);

      // A burst can leave a path over its window with every variant still
      // inside the grace period; if that writer stops, only a pass that looks
      // beyond the paths it just wrote will ever collect the excess.
      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[writtenPath, written[0] ?? ""]]),
        afterGracePeriod(),
      );

      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(burstPath))).length,
        MAX_JSX_CACHE_VARIANTS_PER_PATH,
        "a path over its window must be collected by the next write to any path",
      );
      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(writtenPath))).length,
        1,
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps an old artifact that a render is still holding", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-served-test-" });
    const sourcePath = "/tmp/source/Served.tsx";

    try {
      const names = await writeVariants(tempDir, sourcePath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 4);
      // The oldest variant is the first one a cache hit would be serving.
      const servedName = names[0] ?? "";
      const servedPath = join(tempDir, servedName);
      const nowMs = afterGracePeriod();
      // The render that cache-hit it did so just now, long after the artifact
      // itself was written: creation age alone would make it prunable.
      markJsxArtifactServed(servedPath, nowMs);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
        nowMs,
      );

      const remaining = await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(sourcePath));
      assertEquals(
        remaining.includes(servedName),
        true,
        "an artifact a render just cache-hit must not be retired by its age alone",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("ignores cache files that are not JSX artifacts", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-foreign-test-" });
    const sourcePath = "/tmp/source/Neighbour.tsx";

    try {
      await writeTextFile(join(tempDir, "vfmod-other-deadbeef.mjs"), "export const a = 1;");
      const names = await writeVariants(tempDir, sourcePath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 2);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
        afterGracePeriod(),
      );

      assertEquals(
        (await readTextFile(join(tempDir, "vfmod-other-deadbeef.mjs"))).length > 0,
        true,
        "another cache format's artifacts are not this pass's to retire",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reports an unreadable cache directory instead of failing the transform", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-missing-test-" });
    const notADirectory = join(tempDir, "occupied");

    try {
      await writeTextFile(notADirectory, "export const value = 1;");

      // A cache directory that cannot be enumerated is a cleanup problem, not a
      // render problem: the transform already wrote and returned its artifact.
      await pruneSupersededJsxArtifacts(
        notADirectory,
        new Map([["/tmp/source/Gone.tsx", "jsx-gone.mjs"]]),
      );
      await pruneSupersededJsxArtifacts(
        join(tempDir, "absent"),
        new Map([["/tmp/source/Gone.tsx", "jsx-gone.mjs"]]),
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("re-arms cleanup after an operational directory scan failure", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-scan-retry-test-" });
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    try {
      localFs.readDir = (path) => {
        if (path === tempDir) {
          return {
            // deno-lint-ignore require-yield
            async *[Symbol.asyncIterator]() {
              throw Object.assign(new Error("temporary I/O failure"), { code: "EIO" });
            },
          };
        }
        return originalReadDir(path);
      };

      await collectExcessJsxArtifacts(tempDir, new Map(), Date.now());

      assertEquals(
        hasScheduledJsxCachePrune(tempDir),
        true,
        "an operational scan failure must retain a cleanup obligation",
      );
    } finally {
      localFs.readDir = originalReadDir;
      await remove(tempDir, { recursive: true });
    }
  });

  it("refuses a new artifact when the directory quota is full", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-directory-quota-test-" });
    const nextSource = "/tmp/source/next.tsx";
    const nextName = buildMdxJsxCacheFileName(nextSource, "export const next = true;");
    const nextPath = join(tempDir, nextName);
    try {
      for (let index = 0; index < MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY; index++) {
        const source = `/tmp/source/unique-${index}.tsx`;
        await writeTextFile(
          join(tempDir, buildMdxJsxCacheFileName(source, `export const v = ${index};`)),
          `export const v = ${index};`,
        );
      }

      let wrote = false;
      await assertRejects(
        () =>
          withJsxArtifactWriteCapacity(tempDir, nextPath, async () => {
            wrote = true;
            await writeTextFile(nextPath, "export const next = true;");
          }),
        Error,
        "JSX cache artifact quota is exhausted",
      );
      assertEquals(wrote, false);
      assertEquals(await getLocalFs().exists(nextPath), false);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("ignores a name too short to carry a path prefix", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-short-name-test-" });
    const sourcePath = "/tmp/source/ShortName.tsx";
    const truncated = MDX_JSX_CACHE_NAMESPACE_PREFIX.padEnd(
      MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH,
      "0",
    );

    try {
      await writeTextFile(join(tempDir, truncated), "export const a = 1;");
      const names = await writeVariants(tempDir, sourcePath, MAX_JSX_CACHE_VARIANTS_PER_PATH + 2);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
        afterGracePeriod(),
      );

      assertEquals(
        (await readTextFile(join(tempDir, truncated))).length > 0,
        true,
        "a name with no room for a content digest is not a variant of any path",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("does nothing when the transform wrote no artifact", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-empty-test-" });

    try {
      await writeTextFile(join(tempDir, "untouched.mjs"), "export const value = 1;");
      await pruneSupersededJsxArtifacts(tempDir, new Map());

      const remaining: string[] = [];
      for await (const entry of readDir(tempDir)) remaining.push(entry.name);
      assertEquals(remaining, ["untouched.mjs"]);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("schedules a follow-up that collects a burst the grace period protected", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-followup-test-" });
    const sourcePath = "/tmp/source/BurstThenIdle.tsx";
    const prefix = buildMdxJsxCacheFileNamePrefix(sourcePath);
    const overWindow = MAX_JSX_CACHE_VARIANTS_PER_PATH + 4;

    try {
      const names = await writeVariants(tempDir, sourcePath, overWindow);

      // Every variant is inside the grace period, so this pass removes nothing
      // — and if the tenant now goes idle, no later write will ever trigger
      // another pass. The excess must not depend on one.
      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, names[names.length - 1] ?? ""]]),
      );
      assertEquals((await namesWithPrefix(tempDir, prefix)).length, overWindow);
      assertEquals(
        hasScheduledJsxCachePrune(tempDir),
        true,
        "a pass that leaves over-window variants behind must schedule its own follow-up",
      );

      // What the armed timer runs: a pass with nothing just written, after the
      // grace period has expired.
      await collectExcessJsxArtifacts(tempDir, new Map(), afterGracePeriod());
      assertEquals(
        (await namesWithPrefix(tempDir, prefix)).length,
        MAX_JSX_CACHE_VARIANTS_PER_PATH,
        "the follow-up must enforce the per-path bound without waiting for a write",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reclaims artifacts stranded by a cache namespace roll once they age out", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-stranded-test-" });
    const sourcePath = "/tmp/source/AfterRoll.tsx";
    const strandedName = "jsx-superseded-namespace-deadbeef.mjs";

    try {
      await writeTextFile(join(tempDir, strandedName), "export const old = 1;");
      const written = await writeVariants(tempDir, sourcePath, 1);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, written[0] ?? ""]]),
        afterGracePeriod(),
      );

      const remaining: string[] = [];
      for await (const entry of readDir(tempDir)) remaining.push(entry.name);
      assertEquals(
        remaining.includes(strandedName),
        false,
        "an artifact no current key shape can reach is dead weight to reclaim",
      );
      assertEquals(remaining.includes(written[0] ?? ""), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps a stranded artifact inside the grace period for a draining process", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-stranded-fresh-test-" });
    const sourcePath = "/tmp/source/MidRoll.tsx";
    const strandedName = "jsx-superseded-namespace-cafebabe.mjs";

    try {
      await writeTextFile(join(tempDir, strandedName), "export const old = 1;");
      const written = await writeVariants(tempDir, sourcePath, 1);

      // A rolling deploy can leave a process on the previous namespace still
      // serving this artifact; its age floor is the same one variants get.
      await pruneSupersededJsxArtifacts(tempDir, new Map([[sourcePath, written[0] ?? ""]]));

      const remaining: string[] = [];
      for await (const entry of readDir(tempDir)) remaining.push(entry.name);
      assertEquals(remaining.includes(strandedName), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps an artifact a hit claimed while the pruner was waiting for its lock", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-lock-test-" });
    const contested = join(tempDir, "jsx-contested.mjs");
    const nowMs = afterGracePeriod();

    try {
      await writeTextFile(contested, "export const v = 0;");

      // A cache hit verifies and records the artifact under its lock; a
      // removal that selected the artifact before the hit's mark existed
      // queues behind the same lock and must observe the mark when it runs.
      let releaseHit!: () => void;
      const hitGate = new Promise<void>((resolve) => (releaseHit = resolve));
      const hit = withJsxArtifactLock(contested, async () => {
        await hitGate;
        markJsxArtifactServed(contested, nowMs);
      });
      const removal = removeJsxArtifactUnlessServed(contested, nowMs);

      releaseHit();
      await Promise.all([hit, removal]);

      assertEquals(
        (await readTextFile(contested)).length > 0,
        true,
        "removal must observe a served mark recorded before it acquired the lock",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("waits for a filesystem lease held by another process", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-cross-process-lease-test-" });
    const artifactPath = join(tempDir, "jsx-leased.mjs");
    const leasePath = `${artifactPath}.lock`;
    const createExclusive = getLocalFs().createFileBytesExclusive;
    if (!createExclusive) throw new Error("the test runtime must support exclusive file creation");
    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      await createExclusive(leasePath, new Uint8Array());
      let entered = false;
      const operation = withJsxArtifactLock(artifactPath, async () => {
        entered = true;
      });
      await Promise.resolve();
      assertEquals(entered, false);

      await getLocalFs().remove(leasePath);
      await operation;
      assertEquals(entered, true);
    } finally {
      try {
        await getLocalFs().remove(leasePath);
      } catch { /* already released */ }
      await remove(tempDir, { recursive: true });
    }
  });

  it("recovers a stale filesystem lease left by a terminated process", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-stale-lease-test-" });
    const artifactPath = join(tempDir, "jsx-stale.mjs");
    const leasePath = `${artifactPath}.lock`;
    const createExclusive = getLocalFs().createFileBytesExclusive;
    const staleMs = __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS;
    if (!createExclusive || !getLocalFs().utime) {
      throw new Error("the test runtime must support exclusive creation and file timestamps");
    }
    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      await createExclusive(leasePath, new TextEncoder().encode("terminated-owner"));
      const staleAt = new Date(Date.now() - staleMs - 1);
      await getLocalFs().utime(leasePath, staleAt, staleAt);

      let entered = false;
      await withJsxArtifactLock(artifactPath, async () => {
        entered = true;
      });

      assertEquals(entered, true);
      assertEquals(await getLocalFs().exists(leasePath), false);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reports when a preserved artifact next becomes collectable", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-retry-report-test-" });
    const artifactPath = join(tempDir, "jsx-preserved.mjs");
    const nowMs = afterGracePeriod();

    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      markJsxArtifactServed(artifactPath, nowMs);

      const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
      if (removal.removed) throw new Error("a just-served artifact must be preserved");
      assertEquals(
        removal.retryAtMs,
        nowMs + JSX_CACHE_VARIANT_MIN_AGE_MS,
        "a preserved artifact must name the moment its grace period ends",
      );
      assertEquals((await readTextFile(artifactPath)).length > 0, true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("retains and retries an artifact after an operational removal failure", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-remove-retry-test-" });
    const artifactPath = join(tempDir, "jsx-removal-retry.mjs");
    const nowMs = afterGracePeriod();
    const localFs = getLocalFs();
    const originalRemove = localFs.remove.bind(localFs);
    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      localFs.remove = (path, options) => {
        if (path === artifactPath) {
          return Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }));
        }
        return originalRemove(path, options);
      };

      const failed = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
      if (failed.removed) throw new Error("an operational failure must retain the artifact");
      assertEquals(failed.retryAtMs > nowMs, true);
      assertEquals((await readTextFile(artifactPath)).length > 0, true);

      localFs.remove = originalRemove;
      assertEquals(await removeJsxArtifactUnlessServed(artifactPath, failed.retryAtMs), {
        removed: true,
      });
    } finally {
      localFs.remove = originalRemove;
      await remove(tempDir, { recursive: true });
    }
  });

  it("re-reads the shared mtime before removing, so another process's use wins", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-shared-mtime-test-" });
    const artifactPath = join(tempDir, "jsx-refreshed-elsewhere.mjs");
    const nowMs = afterGracePeriod();

    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      // Another process's cache hit refreshes the shared mtime between this
      // pruner's scan and its removal. That process's memos are invisible
      // here, so only the file's own clock records the use.
      const fs = createFileSystem();
      if (!fs.utime) throw new Error("the test runtime must support utime");
      await fs.utime(artifactPath, new Date(nowMs), new Date(nowMs));

      const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
      if (removal.removed) throw new Error("a freshly used artifact must be preserved");
      assertEquals(
        removal.retryAtMs > nowMs,
        true,
        "the preserved artifact must earn a fresh grace period from its refreshed use",
      );
      assertEquals(
        (await readTextFile(artifactPath)).length > 0,
        true,
        "removal must honor a use it can only see on disk",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps a referenced artifact and schedules a follow-up for its release", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-active-ref-test-" });
    const sourcePath = "/tmp/source/Referenced.tsx";
    const prefix = buildMdxJsxCacheFileNamePrefix(sourcePath);
    const overWindow = MAX_JSX_CACHE_VARIANTS_PER_PATH + 4;

    try {
      const names = await writeVariants(tempDir, sourcePath, overWindow);
      for (const name of names) retainJsxArtifact(join(tempDir, name));

      try {
        // Long past the grace period, but every variant is pinned by a render
        // whose module-recovery phase may run arbitrarily long: nothing may go.
        await collectExcessJsxArtifacts(tempDir, new Map(), afterGracePeriod());
        assertEquals(
          (await namesWithPrefix(tempDir, prefix)).length,
          overWindow,
          "an active reference must protect an artifact past any fixed-age lease",
        );
        assertEquals(
          hasScheduledJsxCachePrune(tempDir),
          true,
          "a pass that preserves referenced artifacts must arrange its own retry",
        );
      } finally {
        for (const name of names) releaseJsxArtifact(join(tempDir, name));
      }

      cancelScheduledJsxCachePrunes();
      await collectExcessJsxArtifacts(tempDir, new Map(), afterGracePeriod());
      assertEquals(
        (await namesWithPrefix(tempDir, prefix)).length,
        MAX_JSX_CACHE_VARIANTS_PER_PATH,
        "releasing the references must make the excess collectable again",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("retires a renamed-away path's last variant once it goes idle", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-idle-test-" });
    const churnedPath = "/tmp/source/Button.tsx";
    const writtenPath = "/tmp/source/Button2.tsx";

    try {
      // A tenant that renames its imported source on each edit leaves one
      // variant per retired path — each in a group too small for the per-path
      // window to ever touch.
      await writeVariants(tempDir, churnedPath, 1);
      const written = await writeVariants(tempDir, writtenPath, 1);

      const beyondIdle = Date.now() + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS + 60_000;
      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[writtenPath, written[0] ?? ""]]),
        beyondIdle,
      );

      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(churnedPath))).length,
        0,
        "a retired path's variants must not outlive the idle floor",
      );
      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(writtenPath))).length,
        1,
        "the artifact the caller just wrote must never be idle-collected",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps a variant that is not yet idle and schedules its idle follow-up", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-not-idle-test-" });
    const churnedPath = "/tmp/source/StillWarm.tsx";
    const writtenPath = "/tmp/source/StillWarm2.tsx";

    try {
      await writeVariants(tempDir, churnedPath, 1);
      const written = await writeVariants(tempDir, writtenPath, 1);

      // Past the grace period but inside the idle floor: an under-window
      // variant may still be a page's live cache entry, so it stays — but the
      // pass must arrange the follow-up that collects it if it stays unused.
      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[writtenPath, written[0] ?? ""]]),
        afterGracePeriod(),
      );

      assertEquals(
        (await namesWithPrefix(tempDir, buildMdxJsxCacheFileNamePrefix(churnedPath))).length,
        1,
        "a variant used within the idle floor is still the cache, not garbage",
      );
      assertEquals(
        hasScheduledJsxCachePrune(tempDir),
        true,
        "idle collection must not depend on an unrelated future write",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("jsx artifact references", () => {
  const {
    cancelScheduledJsxCachePrunes,
    isLazyArtifactRetained,
    LAZY_JSX_ARTIFACT_RETENTION_MS,
    jsxArtifactActiveRefCount,
    removeJsxArtifactUnlessServed,
    wasJsxArtifactRecentlyServed,
  } = __jsxCacheInternals;

  afterEach(() => {
    cancelScheduledJsxCachePrunes();
  });

  it("pins the artifacts a rewritten module imports until released", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-retain-test-" });

    try {
      const cachedCode = "export const v = 1;";
      const artifactPath = join(
        tempDir,
        buildMdxJsxCacheFileName("/tmp/source/Pinned.tsx", cachedCode),
      );
      await writeTextFile(artifactPath, cachedCode);
      const code = [
        `import Pinned from "file://${artifactPath}";`,
        `import { other } from "https://example.com/other.js";`,
        `export default Pinned;`,
      ].join("\n");

      const release = await retainJsxArtifactsReferencedIn(code, tempDir);
      assertEquals(
        jsxArtifactActiveRefCount(artifactPath),
        1,
        "every JSX artifact the module imports must be pinned",
      );

      release();
      assertEquals(jsxArtifactActiveRefCount(artifactPath), 0);
      assertEquals(
        wasJsxArtifactRecentlyServed(artifactPath, Date.now()),
        true,
        "release must leave the served mark that bridges an immediate prune",
      );

      // The release a `finally` runs must stay safe to call more than once.
      release();
      assertEquals(jsxArtifactActiveRefCount(artifactPath), 0);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("retires a lazy artifact after its parent retention window", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-lazy-retain-test-" });
    const artifactPath = join(
      tempDir,
      buildMdxJsxCacheFileName("/tmp/source/Lazy.tsx", "export const lazy = true;"),
    );
    try {
      await writeTextFile(artifactPath, "export const lazy = true;");
      const release = await retainJsxArtifactsReferencedIn(
        `export const load = () => import("file://${artifactPath}");`,
        tempDir,
      );

      release();

      assertEquals(isLazyArtifactRetained(artifactPath), true);
      const expiredAt = Date.now() + LAZY_JSX_ARTIFACT_RETENTION_MS + 1;
      assertEquals(isLazyArtifactRetained(artifactPath, expiredAt), false);
      const removal = await removeJsxArtifactUnlessServed(
        artifactPath,
        expiredAt + JSX_CACHE_VARIANT_MIN_AGE_MS,
      );
      assertEquals(removal.removed, true);
      await assertRejects(() => readTextFile(artifactPath));
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("holds no references for a module that imports no JSX artifacts", async () => {
    const release = await retainJsxArtifactsReferencedIn(
      `import { a } from "https://example.com/a.js";\nexport const b = a;`,
      "/tmp/vf-jsx-empty-cache",
    );
    release();
  });

  it("ignores an artifact-shaped import from outside the cache directory", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-jsx-foreign-cache-" });
    const outsideDir = await makeTempDir({ prefix: "vf-jsx-foreign-source-" });

    try {
      // Only file:// specifiers ending in a JSX/TS extension are rewritten, so
      // a tenant can write this import into MDX and have it survive untouched.
      // Name shape alone must not make it a cache artifact: pinning it would
      // touch a path this cache does not own and evict genuine served marks.
      const foreignPath = join(outsideDir, "jsx-not-an-artifact.mjs");
      await writeTextFile(foreignPath, "export const v = 1;");
      const foreignMtime = (await stat(foreignPath)).mtime?.getTime() ?? 0;

      const release = await retainJsxArtifactsReferencedIn(
        `import foreign from "file://${foreignPath}";\nexport default foreign;`,
        cacheDir,
      );
      assertEquals(
        jsxArtifactActiveRefCount(foreignPath),
        0,
        "an artifact-shaped path outside the cache directory must not be pinned",
      );
      assertEquals(
        (await stat(foreignPath)).mtime?.getTime() ?? 0,
        foreignMtime,
        "a path outside the cache directory must not receive a metadata write",
      );

      release();
      assertEquals(
        wasJsxArtifactRecentlyServed(foreignPath, Date.now()),
        false,
        "a foreign path must never occupy the served-artifact memo",
      );
    } finally {
      await remove(outsideDir, { recursive: true });
      await remove(cacheDir, { recursive: true });
    }
  });

  it("refreshes a stale artifact mtime so other processes see the use", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-touch-test-" });
    const artifactPath = join(tempDir, "jsx-touched.mjs");

    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      const before = (await stat(artifactPath)).mtime?.getTime() ?? 0;

      // A refresh interval ahead of the recorded mtime: the hit must write
      // through to the file so a prune in another process sees the use.
      await refreshJsxArtifactMtime(
        artifactPath,
        before,
        before + JSX_CACHE_VARIANT_MIN_AGE_MS,
      );
      const after = (await stat(artifactPath)).mtime?.getTime() ?? 0;
      assertEquals(
        after > before,
        true,
        "a stale mtime must be refreshed on use",
      );

      // A fresh mtime is left alone so hits cost no metadata write.
      await refreshJsxArtifactMtime(artifactPath, after, after + 1_000);
      assertEquals((await stat(artifactPath)).mtime?.getTime() ?? 0, after);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("remembers its own refresh so an unknown mtime does not force another write", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-touch-memo-test-" });
    const artifactPath = join(tempDir, "jsx-touched-memo.mjs");

    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      const base = (await stat(artifactPath)).mtime?.getTime() ?? 0;

      // The retain path holds no fresh stat, so it reports the mtime as
      // unknown; the first heartbeat writes through.
      await refreshJsxArtifactMtime(artifactPath, 0, base + JSX_CACHE_VARIANT_MIN_AGE_MS);
      const refreshed = (await stat(artifactPath)).mtime?.getTime() ?? 0;
      assertEquals(refreshed > base, true, "an unknown mtime must be refreshed once");

      // Moments later the caller still knows no mtime, but the memo remembers
      // the write: a module with many cached JSX imports must not pay one
      // metadata write per import per render.
      await refreshJsxArtifactMtime(artifactPath, 0, base + JSX_CACHE_VARIANT_MIN_AGE_MS + 1_000);
      assertEquals(
        (await stat(artifactPath)).mtime?.getTime() ?? 0,
        refreshed,
        "a refresh this process just wrote must satisfy the next heartbeat",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("mapJsxTransformsWithCleanup", () => {
  const { mapJsxTransformsWithCleanup } = __importTransformerInternals;

  it("runs cleanup after in-flight callbacks settle when acquisition times out", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));

    // One permit: the first callback holds it past the acquisition timeout, so
    // the second item's wait rejects the whole map outside any callback's try.
    const failure = mapJsxTransformsWithCleanup(
      ["holds-the-permit", "times-out-waiting"],
      async (item: string) => {
        await firstGate;
        events.push(`settled:${item}`);
        return item;
      },
      () => {
        events.push("cleanup");
        return Promise.resolve();
      },
      { semaphore: new Semaphore(1), timeoutMs: 25 },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    // Let the queued acquisition time out while the first callback still holds
    // the only permit, then let that callback finish its write.
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst();

    const error = await failure;
    assertExists(error, "an acquisition timeout must still reject the transform");
    assertEquals(
      events,
      ["settled:holds-the-permit", "cleanup"],
      "cleanup must run after the started callback's write, so the write is covered",
    );
  });
});

describe("isFrameworkSourceFile", () => {
  const { isFrameworkSourceFile } = __importTransformerInternals;

  it("matches the framework source roots shipped in the package", () => {
    assertEquals(
      isFrameworkSourceFile(join(FRAMEWORK_ROOT, "src", "react", "components", "Head.tsx")),
      true,
    );
    assertEquals(
      isFrameworkSourceFile(join(FRAMEWORK_ROOT, "dist", "framework-src", "runtime.ts")),
      true,
    );
  });

  it("does not match a project that lives beneath the framework root", () => {
    // A project under FRAMEWORK_ROOT must keep reading through the adapter, so
    // its JSX source stays subject to the module source-size limit.
    assertEquals(
      isFrameworkSourceFile(join(FRAMEWORK_ROOT, "projects", "mine", "components", "Card.tsx")),
      false,
    );
  });
});

describe("isProjectSourceFile", () => {
  const { isProjectSourceFile } = __importTransformerInternals;

  it("claims a project's own source and its dependencies", () => {
    const projectDir = join(FRAMEWORK_ROOT, "projects", "mine");
    assertEquals(isProjectSourceFile(join(projectDir, "components", "Card.tsx"), projectDir), true);
    assertEquals(
      isProjectSourceFile(join(projectDir, "node_modules", "pkg", "index.jsx"), projectDir),
      true,
      "a dependency inside the project is tenant-controlled and must stay bounded",
    );
  });

  it("claims nothing when the project root is unknown or unrelated", () => {
    assertEquals(isProjectSourceFile("/srv/project/components/Card.tsx"), false);
    assertEquals(isProjectSourceFile("/srv/other/Card.tsx", "/srv/project"), false);
  });

  it("claims containment through a configured root with a trailing slash", () => {
    // resolveProjectDir passes env/context values through unnormalized; a
    // trailing slash must not reclassify a project beneath the framework root
    // as framework source and hand its files to the unbounded local reader.
    const projectDir = `${join(FRAMEWORK_ROOT, "projects", "mine")}/`;
    assertEquals(
      isProjectSourceFile(
        join(FRAMEWORK_ROOT, "projects", "mine", "node_modules", "pkg", "index.jsx"),
        projectDir,
      ),
      true,
    );
    assertEquals(
      isProjectSourceFile(join(FRAMEWORK_ROOT, "projects", "other", "Card.tsx"), projectDir),
      false,
    );
  });
});

describe("describeProjectSource", () => {
  const { describeProjectSource } = __importTransformerInternals;

  it("names a project source by its project-relative path", () => {
    assertEquals(
      describeProjectSource("/srv/deploy/project/components/Card.tsx", "/srv/deploy/project"),
      "components/Card.tsx",
    );
  });

  it("falls back to the file name when no project directory is known", () => {
    assertEquals(describeProjectSource("/srv/deploy/project/components/Card.tsx"), "Card.tsx");
  });

  it("names a source that resolves to nothing outside a path", () => {
    assertEquals(describeProjectSource("/"), "project source");
  });
});

describe("normalized module memo", () => {
  const {
    MAX_NORMALIZED_MODULE_MEMO_ENTRIES,
    rememberNormalizedModule,
    isModuleRemembered,
    normalizedModuleMemoSize,
  } = __jsxCacheInternals;

  it("evicts the oldest path instead of resetting or growing without bound", () => {
    // The memo keys are cache paths, which a project that keeps changing its
    // source produces without limit, so the set has to have a ceiling — but a
    // wholesale wipe at capacity would re-charge every hot page a read and a
    // scan at once, so capacity retires the oldest entries first.
    const additions = MAX_NORMALIZED_MODULE_MEMO_ENTRIES + 8;

    for (let entry = 0; entry < additions; entry++) {
      rememberNormalizedModule(`/tmp/cache/jsx-memo-${entry}.mjs`);
    }

    assertEquals(
      normalizedModuleMemoSize() <= MAX_NORMALIZED_MODULE_MEMO_ENTRIES,
      true,
      "the memo must never hold more paths than its ceiling",
    );
    assertEquals(
      isModuleRemembered(`/tmp/cache/jsx-memo-${additions - 1}.mjs`),
      true,
      "capacity must not cost the paths remembered most recently",
    );
    assertEquals(
      isModuleRemembered("/tmp/cache/jsx-memo-0.mjs"),
      false,
      "reaching the ceiling must retire the oldest path first",
    );
  });
});

describe("scheduled prune bound", () => {
  const {
    cancelScheduledJsxCachePrunes,
    hasScheduledJsxCachePrune,
    MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES,
  } = __jsxCacheInternals;

  afterEach(() => {
    cancelScheduledJsxCachePrunes();
  });

  it("admits new directories by retiring the oldest cleanup timer", () => {
    for (let entry = 0; entry < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES; entry++) {
      ensureJsxCacheSweepArmed(`/tmp/vf-jsx-sweep-bound/${entry}`);
    }

    ensureJsxCacheSweepArmed("/tmp/vf-jsx-sweep-bound/overflow");
    assertEquals(
      hasScheduledJsxCachePrune("/tmp/vf-jsx-sweep-bound/0"),
      false,
      "capacity retires the least-recently armed directory",
    );
    assertEquals(
      hasScheduledJsxCachePrune("/tmp/vf-jsx-sweep-bound/overflow"),
      true,
      "render admission must not fail because other directories hold cleanup timers",
    );
  });
});

describe("served artifact memo", () => {
  const {
    MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
    servedArtifactMemoSize,
    wasJsxArtifactRecentlyServed,
  } = __jsxCacheInternals;

  it("evicts the oldest artifact instead of resetting or growing without bound", () => {
    // Every render of a changing source path adds another artifact path, so
    // the record of what is still in flight needs a ceiling of its own — but a
    // wholesale wipe would momentarily drop the served-reference protection of
    // every in-flight hit, so capacity retires the oldest marks first.
    const nowMs = Date.now();
    const additions = MAX_SERVED_ARTIFACT_MEMO_ENTRIES + 8;

    for (let entry = 0; entry < additions; entry++) {
      markJsxArtifactServed(`/tmp/cache/jsx-served-${entry}.mjs`, nowMs);
    }

    assertEquals(
      servedArtifactMemoSize() <= MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
      true,
      "the memo must never hold more artifact paths than its ceiling",
    );
    assertEquals(
      wasJsxArtifactRecentlyServed(`/tmp/cache/jsx-served-${additions - 1}.mjs`, nowMs),
      true,
      "capacity must not drop the protection of the hits recorded most recently",
    );
    assertEquals(
      wasJsxArtifactRecentlyServed("/tmp/cache/jsx-served-0.mjs", nowMs),
      false,
      "reaching the ceiling must retire the oldest mark first",
    );
  });
});
