import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/jsx-cache.test */

import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
  assertThrows,
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
import { dirname, join } from "#veryfront/compat/path";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
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
import {
  MAX_MDX_MODULE_CODE_BYTES,
  MAX_MDX_MODULE_IMPORTS_PER_FILE,
  ModuleSourceLimitError,
} from "./module-fetcher/limits.ts";
import { getLocalFs } from "./cache/index.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";

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

  it("redacts the project root when strict UTF-8 decoding fails", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-invalid-utf8-test-" });
    const projectDir = "/srv/deployments/tenant-42/project";
    const sourcePath = `${projectDir}/components/Broken.tsx`;
    const warnings: string[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      if (entry.level === "warn") warnings.push(entry.message);
    });
    const adapter = {
      fs: {
        readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array([0xff])),
      },
    } as unknown as RuntimeAdapter;

    try {
      await transformJsxImports(
        `import Broken from "file://${sourcePath}";`,
        adapter,
        tempDir,
        projectDir,
      );

      assertEquals(warnings.some((warning) => warning.includes("components/Broken.tsx")), true);
      assertEquals(warnings.some((warning) => warning.includes(projectDir)), false);
    } finally {
      unsubscribe();
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps a successful transform when its maintenance prune cannot acquire a lease", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-lease-test-" });
    const sourcePath = "/tmp/source/Card.tsx";
    const source = "export const Card = () => <section />;";
    const adapter = {
      fs: { readFile: () => Promise.resolve(source) },
    } as unknown as RuntimeAdapter;
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    const originalWriteTextFile = localFs.writeTextFile.bind(localFs);
    let artifactWritten = false;
    let pruneFailed = false;
    localFs.writeTextFile = async (path: string, content: string) => {
      await originalWriteTextFile(path, content);
      if (path.includes("jsx-")) artifactWritten = true;
    };
    localFs.readDir = (path: string) => {
      if (path === tempDir && artifactWritten && !pruneFailed) {
        pruneFailed = true;
        throw new Error("lease acquisition timed out");
      }
      return originalReadDir(path);
    };

    try {
      const transformed = await transformJsxImports(
        `import Card from "file://${sourcePath}";`,
        adapter,
        tempDir,
      );

      assertEquals(transformed.includes("jsx-"), true);
      assertEquals(__jsxCacheInternals.hasScheduledJsxCachePrune(tempDir), true);
    } finally {
      localFs.readDir = originalReadDir;
      localFs.writeTextFile = originalWriteTextFile;
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
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
    scheduleJsxCachePruneRetry,
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

  async function countJsxArtifacts(dir: string): Promise<number> {
    let count = 0;
    for await (const entry of readDir(dir)) {
      if (entry.isFile && entry.name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)) count++;
    }
    return count;
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

  it("evicts one eligible artifact to reserve write headroom at capacity", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-directory-headroom-test-" });
    const nextPath = join(
      tempDir,
      buildMdxJsxCacheFileName("/tmp/source/next.tsx", "export const next = true;"),
    );
    const localFs = getLocalFs();
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");
    const eligibleAt = new Date(Date.now() - JSX_CACHE_VARIANT_MIN_AGE_MS - 1_000);

    try {
      for (let index = 0; index < MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY; index++) {
        const path = join(
          tempDir,
          buildMdxJsxCacheFileName(
            `/tmp/source/eligible-${index}.tsx`,
            `export const value = ${index};`,
          ),
        );
        await writeTextFile(path, `export const value = ${index};`);
        await utime(path, eligibleAt, eligibleAt);
      }

      await withJsxArtifactWriteCapacity(tempDir, nextPath, async () => {
        await writeTextFile(nextPath, "export const next = true;");
      });

      assertEquals(await localFs.exists(nextPath), true);
      assertEquals(await countJsxArtifacts(tempDir), MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reserves the full current-namespace capacity after a namespace upgrade", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-namespace-headroom-test-" });
    const nextPath = join(
      tempDir,
      buildMdxJsxCacheFileName("/tmp/source/next.tsx", "export const next = true;"),
    );
    try {
      for (let index = 0; index < MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY; index++) {
        await writeTextFile(
          join(tempDir, `jsx-prior-namespace-${index}.mjs`),
          `export const old = ${index};`,
        );
      }
      // A previous rollout may already have consumed one request's worth of
      // the new namespace before another disjoint 500-import page renders.
      // Prior generations must not consume the current namespace's own quota.
      for (let index = 0; index < MAX_MDX_MODULE_IMPORTS_PER_FILE; index++) {
        await writeTextFile(
          join(
            tempDir,
            buildMdxJsxCacheFileName(
              `/tmp/source/current-${index}.tsx`,
              `export const current = ${index};`,
            ),
          ),
          `export const current = ${index};`,
        );
      }

      await withJsxArtifactWriteCapacity(tempDir, nextPath, async () => {
        await writeTextFile(nextPath, "export const next = true;");
      });

      assertEquals(await getLocalFs().exists(nextPath), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("recounts the shared namespace before each artifact write", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-directory-count-test-" });
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    let directoryScans = 0;
    localFs.readDir = (path) => {
      if (path === tempDir) directoryScans++;
      return originalReadDir(path);
    };

    try {
      const firstPath = join(
        tempDir,
        buildMdxJsxCacheFileName("/tmp/source/first.tsx", "export const first = true;"),
      );
      const secondPath = join(
        tempDir,
        buildMdxJsxCacheFileName("/tmp/source/second.tsx", "export const second = true;"),
      );
      await withJsxArtifactWriteCapacity(
        tempDir,
        firstPath,
        () => writeTextFile(firstPath, "export const first = true;"),
      );
      const scansAfterFirstWrite = directoryScans;

      await withJsxArtifactWriteCapacity(
        tempDir,
        secondPath,
        () => writeTextFile(secondPath, "export const second = true;"),
      );

      assertEquals(
        directoryScans,
        scansAfterFirstWrite + 1,
        "the next write needs one authoritative quota scan and no lock-transition scan",
      );
    } finally {
      localFs.readDir = originalReadDir;
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps waiting for directory capacity beyond the artifact lease retry window", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-directory-wait-test-" });
    const artifactPath = join(
      tempDir,
      buildMdxJsxCacheFileName("/tmp/source/wait.tsx", "export const waited = true;"),
    );
    const quotaLockPath = join(tempDir, ".jsx-directory-quota.lock");
    const localFs = getLocalFs();
    const createExclusive = localFs.createFileBytesExclusive;
    if (!createExclusive) {
      throw new Error("the test runtime must support exclusive file creation");
    }

    try {
      await createExclusive(quotaLockPath, new TextEncoder().encode("live-owner"));
      const release = setTimeout(() => {
        void localFs.remove(quotaLockPath).catch(() => undefined);
      }, 5_200);
      await withJsxArtifactWriteCapacity(
        tempDir,
        artifactPath,
        () => writeTextFile(artifactPath, "export const waited = true;"),
      );
      clearTimeout(release);

      assertEquals(await localFs.exists(artifactPath), true);
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
        Date.now() + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS + 60_000,
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

  it("re-arms a scheduled sweep that a lease failure aborted partway", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-abort-test-" });
    const strandedName = "jsx-superseded-namespace-aborted.mjs";
    const localFs = getLocalFs();
    const originalReadTextFile = localFs.readTextFile.bind(localFs);
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");

    try {
      await writeTextFile(join(tempDir, strandedName), "export const old = 1;");
      // Old enough that the sweep reaches the removal, which needs the lease.
      const agedAt = new Date(Date.now() - JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS - 60_000);
      await localFs.utime?.(join(tempDir, strandedName), agedAt, agedAt);
      // An operational failure reading back the lease owner, not a contended
      // lock: the ownership fence throws, so the pass aborts instead of
      // preserving the artifact and naming its own retry.
      let leaseReads = 0;
      localFs.readTextFile = () => {
        leaseReads++;
        return Promise.reject(new Error("EIO"));
      };

      scheduleJsxCachePruneRetry(tempDir, 0);
      // The entry is armed before the timer fires and dropped when it does, so
      // wait for the pass to reach the lease and for its rejection to settle.
      for (
        let attempt = 0;
        attempt < 200 && (leaseReads === 0 || !hasScheduledJsxCachePrune(tempDir));
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      assertEquals(leaseReads > 0, true, "the scheduled pass must have reached the lease");
      assertEquals(
        hasScheduledJsxCachePrune(tempDir),
        true,
        "an aborted sweep drops its own timer, so it must arm the next one itself",
      );
      assertEquals(
        await getLocalFs().exists(join(tempDir, strandedName)),
        true,
        "the artifact the aborted pass could not reach must still be there to collect",
      );
    } finally {
      localFs.readTextFile = originalReadTextFile;
      await remove(tempDir, { recursive: true });
    }
  });

  it("sweeps the stale lease tombstones a recovery could not remove", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-tombstone-test-" });
    const sourcePath = "/tmp/source/Tombstone.tsx";
    // The two lock paths this loader leases: a per-artifact lock and the
    // directory-wide quota lock. A recovery that dies between its rename and
    // its removal leaves either shape behind, and no artifact accounting
    // covers them.
    const tombstones = [
      "jsx-abandoned.mjs.lock.stale-2a4b8c1d-3e5f-4a6b-8c7d-9e0f1a2b3c4d",
      ".jsx-directory-quota.lock.stale-7f6e5d4c-3b2a-4190-8765-4321fedcba09",
    ];
    const unrelated = "keep-me.lock.stale-0badc0de-1111-4222-8333-444455556666";

    try {
      for (const name of tombstones) await writeTextFile(join(tempDir, name), "lease-owner");
      await writeTextFile(join(tempDir, unrelated), "not-ours");
      const written = await writeVariants(tempDir, sourcePath, 1);

      await pruneSupersededJsxArtifacts(
        tempDir,
        new Map([[sourcePath, written[0] ?? ""]]),
        afterGracePeriod(),
      );

      const remaining: string[] = [];
      for await (const entry of readDir(tempDir)) remaining.push(entry.name);
      for (const name of tombstones) {
        assertEquals(
          remaining.includes(name),
          false,
          "a tombstone no later pass would revisit grows the cache directory without limit",
        );
      }
      assertEquals(remaining.includes(unrelated), true);
      assertEquals(remaining.includes(written[0] ?? ""), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not sweep a live release tombstone", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-live-release-test-" });
    const tombstone = join(
      tempDir,
      "jsx-live.mjs.lock.release-11111111-1111-4111-8111-111111111111",
    );
    try {
      await writeTextFile(tombstone, "lease-owner");

      await collectExcessJsxArtifacts(tempDir, new Map(), Date.now());

      assertEquals(await getLocalFs().exists(tombstone), true);
      assertEquals(hasScheduledJsxCachePrune(tempDir), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not sweep a live stale-recovery tombstone", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-live-stale-test-" });
    const tombstone = join(
      tempDir,
      "jsx-live.mjs.lock.stale-11111111-1111-4111-8111-111111111111",
    );
    try {
      await writeTextFile(tombstone, "replacement-owner");

      await collectExcessJsxArtifacts(tempDir, new Map(), Date.now());

      assertEquals(await getLocalFs().exists(tombstone), true);
      assertEquals(hasScheduledJsxCachePrune(tempDir), true);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("recovers stale orphan artifact lease files", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-orphan-lock-test-" });
    const staleArtifact = "jsx-orphaned.mjs";
    const freshArtifact = "jsx-active-create.mjs";
    const localFs = getLocalFs();
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");

    try {
      await writeTextFile(join(tempDir, `${staleArtifact}.lock`), "stale-owner");
      await writeTextFile(join(tempDir, `${freshArtifact}.lock`), "fresh-owner");
      const staleAt = new Date(
        Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1_000,
      );
      await utime(join(tempDir, `${staleArtifact}.lock`), staleAt, staleAt);

      await __jsxCacheInternals.collectExcessJsxArtifacts(
        tempDir,
        new Map(),
        Date.now(),
      );

      assertEquals(await localFs.exists(join(tempDir, `${staleArtifact}.lock`)), false);
      assertEquals((await localFs.stat(join(tempDir, `${freshArtifact}.lock`))).isFile, true);
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

  it("propagates operational artifact stat failures", async () => {
    const localFs = getLocalFs();
    const originalStat = localFs.stat.bind(localFs);
    localFs.stat = () => Promise.reject(new Error("transient stat failure"));

    try {
      await assertRejects(
        () => readArtifactModifiedAtMs("/tmp/jsx-operational-stat.mjs"),
        Error,
        "transient stat failure",
      );
    } finally {
      localFs.stat = originalStat;
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

  it("does not scan the cache directory for an uncontended artifact lease", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-uncontended-lease-test-" });
    const artifactPath = join(tempDir, "jsx-uncontended.mjs");
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    let scans = 0;
    localFs.readDir = (path) => {
      if (path === tempDir) scans++;
      return originalReadDir(path);
    };

    try {
      await withJsxArtifactLock(artifactPath, async () => undefined);
      assertEquals(scans, 0);
    } finally {
      localFs.readDir = originalReadDir;
      await remove(tempDir, { recursive: true });
    }
  });

  it("bounds artifact metadata reads across concurrent prune passes", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-prune-workers-" });
    const localFs = getLocalFs();
    const originalStat = localFs.stat.bind(localFs);
    let active = 0;
    let peak = 0;
    try {
      const directories = [join(tempDir, "first"), join(tempDir, "second")];
      for (const directory of directories) {
        await mkdir(directory, { recursive: true });
        await writeVariants(directory, "/source/shared.tsx", 40);
      }
      localFs.stat = async (path) => {
        if (!path.endsWith(".mjs")) return originalStat(path);
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return await originalStat(path);
        } finally {
          active--;
        }
      };
      await Promise.all(
        directories.map((directory) => collectExcessJsxArtifacts(directory, new Map(), Date.now())),
      );
      assertEquals(peak <= __jsxCacheInternals.JSX_ARTIFACT_REFRESH_CONCURRENCY, true);
    } finally {
      localFs.stat = originalStat;
      await remove(tempDir, { recursive: true });
    }
  });

  it("hands a released metadata slot to the oldest waiter before a barging caller", async () => {
    const { JSX_ARTIFACT_REFRESH_CONCURRENCY, withJsxArtifactRefreshSlot } = __jsxCacheInternals;
    const releaseHolders = Promise.withResolvers<void>();
    let holdersStarted = 0;
    const holders = Array.from(
      { length: JSX_ARTIFACT_REFRESH_CONCURRENCY },
      () =>
        withJsxArtifactRefreshSlot(async () => {
          holdersStarted++;
          await releaseHolders.promise;
        }),
    );
    while (holdersStarted < JSX_ARTIFACT_REFRESH_CONCURRENCY) await Promise.resolve();

    const order: string[] = [];
    const oldest = withJsxArtifactRefreshSlot(async () => {
      order.push("oldest");
    });
    await Promise.resolve();
    releaseHolders.resolve();
    const barger = withJsxArtifactRefreshSlot(async () => {
      order.push("barger");
    });

    await Promise.all([...holders, oldest, barger]);
    assertEquals(order, ["oldest", "barger"]);
  });

  it("reclaims a stale transition only while owning the canonical lease", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-transition-owner-test-" });
    const artifactPath = join(tempDir, "jsx-transition-owner.mjs");
    const leasePath = `${artifactPath}.lock`;
    const transitionPath = `${leasePath}.transition`;
    const localFs = getLocalFs();
    const originalRemove = localFs.remove.bind(localFs);
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support atomic cache leases");
    let removedUnderCanonicalLease = false;
    try {
      await writeTextFile(transitionPath, "stale-transition-owner");
      const staleAt = new Date(
        Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1_000,
      );
      await utime(transitionPath, staleAt, staleAt);
      localFs.remove = async (path, options) => {
        if (path === transitionPath && !removedUnderCanonicalLease) {
          removedUnderCanonicalLease = await localFs.exists(leasePath);
        }
        await originalRemove(path, options);
      };

      await withJsxArtifactLock(artifactPath, async () => undefined);
      assertEquals(removedUnderCanonicalLease, true);
    } finally {
      localFs.remove = originalRemove;
      await remove(tempDir, { recursive: true });
    }
  });

  it("removes a provisional lease when transition inspection fails", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-transition-read-failure-" });
    const artifactPath = join(tempDir, "jsx-transition-failure.mjs");
    const leasePath = `${artifactPath}.lock`;
    const localFs = getLocalFs();
    const originalStat = localFs.stat.bind(localFs);
    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      localFs.stat = (path) => {
        if (path === `${leasePath}.transition`) {
          return Promise.reject(new Error("transition unavailable"));
        }
        return originalStat(path);
      };

      await assertRejects(
        () => withJsxArtifactLock(artifactPath, async () => {}),
        Error,
        "transition unavailable",
      );
      assertEquals(await localFs.exists(leasePath), false);
    } finally {
      localFs.stat = originalStat;
      await remove(tempDir, { recursive: true });
    }
  });

  it("keeps successful work when transition cleanup fails", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-transition-cleanup-test-" });
    const artifactPath = join(tempDir, "jsx-transition-cleanup.mjs");
    const transitionPath = `${artifactPath}.lock.transition`;
    const localFs = getLocalFs();
    const originalRemove = localFs.remove.bind(localFs);
    try {
      localFs.remove = (path, options) => {
        if (path === transitionPath) {
          return Promise.reject(Object.assign(new Error("transition busy"), { code: "EBUSY" }));
        }
        return originalRemove(path, options);
      };

      assertEquals(
        await withJsxArtifactLock(artifactPath, async () => "completed"),
        "completed",
      );
      assertEquals(
        __jsxCacheInternals.hasScheduledJsxCachePrune(tempDir),
        true,
        "failed fence cleanup must preserve a maintenance obligation",
      );
    } finally {
      localFs.remove = originalRemove;
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not remove a replacement lease during stale-owner release", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-release-owner-test-" });
    const artifactPath = join(tempDir, "jsx-release-owner.mjs");
    const leasePath = `${artifactPath}.lock`;
    const localFs = getLocalFs();
    const originalReadTextFile = localFs.readTextFile.bind(localFs);
    const originalWriteTextFile = localFs.writeTextFile.bind(localFs);
    const originalRename = localFs.rename?.bind(localFs);
    const createExclusive = localFs.createFileBytesExclusive;
    if (!originalRename) throw new Error("the test runtime must support atomic rename");
    if (!createExclusive) throw new Error("the test runtime must support exclusive create");
    let lockReads = 0;
    let replacementInjected = false;
    let thirdOwnerInjected = false;
    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      localFs.readTextFile = async (path) => {
        const value = await originalReadTextFile(path);
        if (path === leasePath && ++lockReads === 2) {
          await originalWriteTextFile(leasePath, "replacement-owner");
        }
        return value;
      };
      localFs.rename = async (from, to) => {
        if (from === leasePath && to.includes(".release-") && !replacementInjected) {
          replacementInjected = true;
          await originalWriteTextFile(leasePath, "replacement-owner");
        }
        await originalRename(from, to);
        if (from === leasePath && to.includes(".release-") && !thirdOwnerInjected) {
          thirdOwnerInjected = true;
          await createExclusive(leasePath, new TextEncoder().encode("third-owner"));
          setTimeout(() => {
            void localFs.remove(leasePath).catch(() => undefined);
          }, 0);
        }
        return;
      };

      await withJsxArtifactLock(artifactPath, async () => {});

      assertEquals(await originalReadTextFile(leasePath), "replacement-owner");
    } finally {
      localFs.readTextFile = originalReadTextFile;
      localFs.writeTextFile = originalWriteTextFile;
      localFs.rename = originalRename;
      await remove(tempDir, { recursive: true });
    }
  });

  it("recovers a stale filesystem lease left by a terminated process", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-stale-lease-test-" });
    const artifactPath = join(tempDir, "jsx-stale.mjs");
    const leasePath = `${artifactPath}.lock`;
    const localFs = getLocalFs();
    const createExclusive = localFs.createFileBytesExclusive;
    const utime = localFs.utime?.bind(localFs);
    const staleMs = __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS;
    if (!createExclusive || !utime) {
      throw new Error("the test runtime must support exclusive creation and file timestamps");
    }
    try {
      await writeTextFile(artifactPath, "export const v = 0;");
      await createExclusive(leasePath, new TextEncoder().encode("terminated-owner"));
      const staleAt = new Date(Date.now() - staleMs - 1);
      await localFs.utime?.(leasePath, staleAt, staleAt);

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

  it("keeps the recovery fence when the renamed owner cannot be read", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-recovery-read-test-" });
    const leasePath = join(tempDir, "jsx-read.mjs.lock");
    const localFs = getLocalFs();
    const originalRead = localFs.readTextFile.bind(localFs);
    const createExclusive = localFs.createFileBytesExclusive;
    if (!createExclusive || !localFs.utime) throw new Error("Expected atomic filesystem support");
    try {
      await writeTextFile(leasePath, "owner");
      const staleAt = new Date(Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1000);
      await localFs.utime(leasePath, staleAt, staleAt);
      localFs.readTextFile = (path) =>
        path.includes(".stale-")
          ? Promise.reject(Object.assign(new Error("read unavailable"), { code: "EIO" }))
          : originalRead(path);
      assertEquals(
        await __jsxCacheInternals.recoverStaleFilesystemLease(
          leasePath,
          Date.now(),
          createExclusive,
        ),
        false,
      );
      assertEquals(await localFs.exists(`${leasePath}.transition`), true);
    } finally {
      localFs.readTextFile = originalRead;
      await remove(tempDir, { recursive: true });
    }
  });

  it("recovers a stale lease behind an abandoned transition fence", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-stale-transition-test-" });
    const artifactPath = join(tempDir, "jsx-stale-transition.mjs");
    const leasePath = `${artifactPath}.lock`;
    const transitionPath = `${leasePath}.transition`;
    const localFs = getLocalFs();
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");
    try {
      await writeTextFile(leasePath, "abandoned-lease-owner");
      await writeTextFile(transitionPath, "abandoned-transition-owner");
      const staleAt = new Date(
        Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1_000,
      );
      await utime(leasePath, staleAt, staleAt);
      await utime(transitionPath, staleAt, staleAt);

      let entered = false;
      await withJsxArtifactLock(artifactPath, async () => {
        entered = true;
      });

      assertEquals(entered, true);
      assertEquals(await localFs.exists(transitionPath), false);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("fences a protected mutation after filesystem lease ownership changes", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-lease-fence-test-" });
    const artifactPath = join(tempDir, "jsx-fenced.mjs");
    const leasePath = `${artifactPath}.lock`;
    let mutated = false;
    try {
      await writeTextFile(artifactPath, "export const v = 0;");

      await assertRejects(
        () =>
          withJsxArtifactLock(artifactPath, async (assertLeaseOwned) => {
            await writeTextFile(leasePath, "replacement-owner");
            await assertLeaseOwned();
            mutated = true;
          }),
        Error,
        "lease ownership changed",
      );

      assertEquals(mutated, false);
      assertEquals(await readTextFile(artifactPath), "export const v = 0;");
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("fences a stale holder as soon as recovery starts", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-recovery-fence-test-" });
    const artifactPath = join(tempDir, "jsx-recovery-fence.mjs");
    const transitionPath = `${artifactPath}.lock.transition`;
    try {
      await withJsxArtifactLock(artifactPath, async (assertOwned) => {
        await writeTextFile(transitionPath, "recovering-owner");
        try {
          await assertRejects(assertOwned, Error, "ownership changed");
        } finally {
          await remove(transitionPath);
        }
      });
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
    retainLazyJsxArtifact,
    runLazyJsxArtifactHeartbeat,
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

  it("rolls back active references when initial refresh fails", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-retain-rollback-test-" });
    // The artifact names a directory that does not exist, so the lease the
    // refresh takes cannot be created and the failure surfaces on the first
    // attempt. A reference is taken before the refresh runs, so the rollback
    // this asserts is what keeps a failed retention from pinning the artifact
    // against every later prune pass for the life of the process.
    const artifactPath = join(
      tempDir,
      "absent",
      buildMdxJsxCacheFileName("/tmp/source/Rollback.tsx", "export const v = 1;"),
    );
    try {
      await assertRejects(
        () =>
          retainJsxArtifactsReferencedIn(
            `import Rollback from "file://${artifactPath}";`,
            tempDir,
          ),
        Error,
      );
      assertEquals(jsxArtifactActiveRefCount(artifactPath), 0);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("rejects retention when shared recency cannot be refreshed", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-retain-recurrency-test-" });
    const artifactPath = join(
      tempDir,
      buildMdxJsxCacheFileName("/tmp/source/NoUtime.tsx", "export const v = 1;"),
    );
    const localFs = getLocalFs();
    const originalUtime = localFs.utime?.bind(localFs);
    try {
      await writeTextFile(artifactPath, "export const v = 1;");
      localFs.utime = undefined;

      await assertRejects(
        () =>
          retainJsxArtifactsReferencedIn(
            `import NoUtime from "file://${artifactPath}";`,
            tempDir,
          ),
        Error,
        "Shared JSX artifact recency refresh is unavailable",
      );
      assertEquals(jsxArtifactActiveRefCount(artifactPath), 0);
    } finally {
      localFs.utime = originalUtime;
      await remove(tempDir, { recursive: true });
    }
  });

  it("redacts native paths from required timestamp refresh errors", async () => {
    const localFs = getLocalFs();
    const originalUtime = localFs.utime?.bind(localFs);
    const artifactPath = "private-cache/jsx-required-refresh.mjs";
    try {
      localFs.utime = () => Promise.reject(new Error(`EACCES: ${artifactPath}`));
      const error = await assertRejects(
        () => refreshJsxArtifactMtime(artifactPath, 0, Date.now(), true),
        Error,
      );
      assert(error instanceof Error);
      assertEquals(error.message, "Shared JSX artifact recency refresh failed (FILESYSTEM_ERROR)");
    } finally {
      localFs.utime = originalUtime;
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

  it("bounds lazy artifact retention without evicting an existing reservation", () => {
    const limit = __jsxCacheInternals.MAX_SERVED_ARTIFACT_MEMO_ENTRIES;
    for (let index = 0; index < limit; index++) {
      __jsxCacheInternals.retainLazyJsxArtifact(`/cache/project-${index}/jsx-lazy.mjs`);
    }
    assertThrows(
      () => __jsxCacheInternals.retainLazyJsxArtifact("/cache/overflow/jsx-lazy.mjs"),
      Error,
      "retention capacity",
    );
    assertEquals(__jsxCacheInternals.isLazyArtifactRetained("/cache/project-0/jsx-lazy.mjs"), true);
    __jsxCacheInternals.retainLazyJsxArtifact("/cache/project-0/jsx-lazy.mjs");
  });

  it("shares one bounded lazy heartbeat batch while storage is slow", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-lazy-heartbeat-test-" });
    const artifactPath = join(
      tempDir,
      buildMdxJsxCacheFileName("/tmp/source/Heartbeat.tsx", "export const value = 1;"),
    );
    const localFs = getLocalFs();
    const originalUtime = localFs.utime?.bind(localFs);
    if (!originalUtime) throw new Error("the test runtime must support file timestamps");
    let releaseUtime: (() => void) | undefined;
    const utimeBlocked = new Promise<void>((resolve) => {
      releaseUtime = resolve;
    });
    let markUtimeStarted: (() => void) | undefined;
    const utimeStarted = new Promise<void>((resolve) => {
      markUtimeStarted = resolve;
    });

    try {
      await writeTextFile(artifactPath, "export const value = 1;");
      retainLazyJsxArtifact(artifactPath);
      localFs.utime = async (...args) => {
        markUtimeStarted?.();
        await utimeBlocked;
        return await originalUtime(...args);
      };

      const first = runLazyJsxArtifactHeartbeat();
      await utimeStarted;
      const second = runLazyJsxArtifactHeartbeat();
      assert(first === second, "overlapping timer ticks must share one heartbeat batch");
      releaseUtime?.();
      await first;
    } finally {
      releaseUtime?.();
      localFs.utime = originalUtime;
      await remove(tempDir, { recursive: true });
    }
  });

  it("bounds filesystem refreshes for actively retained artifacts", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-active-heartbeat-test-" });
    const localFs = getLocalFs();
    const originalUtime = localFs.utime?.bind(localFs);
    if (!originalUtime) throw new Error("the test runtime must support file timestamps");
    const releaseUtime = Promise.withResolvers<void>();
    const artifactPaths: string[] = [];
    let retained: Promise<() => void> | undefined;
    let active = 0;
    let maximumActive = 0;
    try {
      for (let index = 0; index < 12; index++) {
        const artifactPath = join(
          tempDir,
          buildMdxJsxCacheFileName(
            `/tmp/source/Active-${index}.tsx`,
            `export const value = ${index};`,
          ),
        );
        artifactPaths.push(artifactPath);
        await writeTextFile(artifactPath, `export const value = ${index};`);
      }
      localFs.utime = async (...args) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          await releaseUtime.promise;
          return await originalUtime(...args);
        } finally {
          active -= 1;
        }
      };
      retained = retainJsxArtifactsReferencedIn(
        artifactPaths.map((path, index) => `import * as m${index} from "file://${path}";`).join(
          "\n",
        ),
        tempDir,
      );
      for (let attempt = 0; attempt < 200 && active < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      assertEquals(active, __jsxCacheInternals.JSX_ARTIFACT_REFRESH_CONCURRENCY);
      assertEquals(maximumActive, __jsxCacheInternals.JSX_ARTIFACT_REFRESH_CONCURRENCY);
      releaseUtime.resolve();
      const release = await retained;
      release();
    } finally {
      releaseUtime.resolve();
      await retained?.catch(() => undefined);
      localFs.utime = originalUtime;
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
  const persistedTestPrefix = "/tmp/vf-jsx-sweep-persisted/";
  const {
    cancelScheduledJsxCachePrunes,
    clearPersistedJsxCachePruneRequestsForTests,
    getPersistedJsxCachePruneRequestPath,
    hasActiveScheduledJsxCachePrune,
    hasScheduledJsxCachePrune,
    hasPersistedJsxCachePrune,
    MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES,
    persistJsxCachePruneRequest,
    promotePersistedJsxCachePruneRequest,
    queueJsxCachePrune,
    queuedJsxCachePruneCount,
    retirePersistedJsxCachePruneRequest,
    scheduleJsxCachePruneRetry,
    scheduledJsxCachePruneCount,
    waitForJsxCacheMaintenanceForTests,
  } = __jsxCacheInternals;

  afterEach(async () => {
    cancelScheduledJsxCachePrunes();
    await waitForJsxCacheMaintenanceForTests();
    cancelScheduledJsxCachePrunes();
    await clearPersistedJsxCachePruneRequestsForTests(persistedTestPrefix);
  });

  it("queues overflow directories without canceling active cleanup timers", () => {
    for (let entry = 0; entry < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES; entry++) {
      ensureJsxCacheSweepArmed(`/tmp/vf-jsx-sweep-bound/${entry}`);
    }

    ensureJsxCacheSweepArmed("/tmp/vf-jsx-sweep-bound/overflow");
    assertEquals(
      hasScheduledJsxCachePrune("/tmp/vf-jsx-sweep-bound/0"),
      true,
      "capacity must not cancel an already scheduled directory",
    );
    assertEquals(
      hasScheduledJsxCachePrune("/tmp/vf-jsx-sweep-bound/overflow"),
      true,
      "render admission must not fail because other directories hold cleanup timers",
    );
    assertEquals(scheduledJsxCachePruneCount(), MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES);
    assertEquals(queuedJsxCachePruneCount(), 1);
  });

  it("replaces a later timer so an urgent overflow deadline can run", () => {
    for (let entry = 0; entry < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES; entry++) {
      scheduleJsxCachePruneRetry(
        `/tmp/vf-jsx-sweep-deadline/${entry}`,
        JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
      );
    }

    const urgent = "/tmp/vf-jsx-sweep-deadline/urgent";
    scheduleJsxCachePruneRetry(urgent, JSX_CACHE_VARIANT_MIN_AGE_MS);

    assertEquals(hasActiveScheduledJsxCachePrune(urgent), true);
    assertEquals(scheduledJsxCachePruneCount(), MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES);
    assertEquals(queuedJsxCachePruneCount(), 1);
  });

  it("promotes persisted work outside the originating cache context", async () => {
    const firstRoot = await makeTempDir({ prefix: "vf-jsx-context-first-" });
    const secondRoot = await makeTempDir({ prefix: "vf-jsx-context-second-" });
    const target = `${persistedTestPrefix}cross-context`;
    try {
      await runWithCacheDir(firstRoot, () =>
        __jsxCacheInternals.persistJsxCachePruneRequest(
          target,
          Date.now() + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
        ));
      await runWithCacheDir(
        secondRoot,
        () => __jsxCacheInternals.promotePersistedJsxCachePruneRequest(),
      );
      assertEquals(__jsxCacheInternals.hasScheduledJsxCachePrune(target), true);
    } finally {
      await remove(firstRoot, { recursive: true });
      await remove(secondRoot, { recursive: true });
    }
  });

  it("persists directories beyond the bounded in-memory backlog", async () => {
    await clearPersistedJsxCachePruneRequestsForTests(persistedTestPrefix);
    for (let entry = 0; entry < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES * 2; entry++) {
      ensureJsxCacheSweepArmed(`${persistedTestPrefix}${entry}`);
    }
    const overflow = `${persistedTestPrefix}overflow`;
    ensureJsxCacheSweepArmed(overflow);

    for (let attempt = 0; attempt < 100; attempt++) {
      if (await hasPersistedJsxCachePrune(overflow)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assertEquals(await hasPersistedJsxCachePrune(overflow), true);
    assertEquals(scheduledJsxCachePruneCount(), MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES);
    assertEquals(queuedJsxCachePruneCount(), MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES);
  });

  it("promotes work after persistence completes beyond an empty promotion scan", async () => {
    const localFs = getLocalFs();
    const originalWrite = localFs.writeTextFile.bind(localFs);
    const originalReadDir = localFs.readDir.bind(localFs);
    const writeStarted = Promise.withResolvers<void>();
    const releaseWrite = Promise.withResolvers<void>();
    const nowMs = Date.now();
    const urgent = `${persistedTestPrefix}post-persist-promotion`;
    let urgentScanStarted = false;
    try {
      localFs.readDir = (path) => {
        if (path === urgent) urgentScanStarted = true;
        return originalReadDir(path);
      };
      for (let entry = 0; entry < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES; entry++) {
        queueJsxCachePrune(`${persistedTestPrefix}queued-${entry}`, nowMs + 60_000);
      }
      localFs.writeTextFile = async (path, content) => {
        if (path.endsWith(".json")) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        return await originalWrite(path, content);
      };

      queueJsxCachePrune(urgent, nowMs);
      await writeStarted.promise;
      await promotePersistedJsxCachePruneRequest();
      releaseWrite.resolve();

      for (let attempt = 0; attempt < 100; attempt++) {
        if (urgentScanStarted) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      // A due-now timer can run and leave the schedule before the next poll.
      // Observe execution, not that transient intermediate queue state.
      assertEquals(
        urgentScanStarted,
        true,
        "successful persistence must wake promotion after an earlier empty scan",
      );
    } finally {
      releaseWrite.resolve();
      localFs.writeTextFile = originalWrite;
      localFs.readDir = originalReadDir;
    }
  });

  it("bounds concurrent scheduled directory scans", async () => {
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    const releaseScans = Promise.withResolvers<void>();
    const directoryPrefix = `${persistedTestPrefix}scheduled-scan-`;
    let active = 0;
    let peak = 0;
    let started = 0;
    localFs.readDir = (path) => {
      if (!path.startsWith(directoryPrefix)) return originalReadDir(path);
      return (async function* () {
        active++;
        started++;
        peak = Math.max(peak, active);
        try {
          await releaseScans.promise;
          for await (const entry of originalReadDir(path)) yield entry;
        } finally {
          active--;
        }
      })();
    };

    try {
      for (let entry = 0; entry < 16; entry++) {
        scheduleJsxCachePruneRetry(`${directoryPrefix}${entry}`, 0);
      }
      for (
        let attempt = 0;
        attempt < 100 && started < __jsxCacheInternals.SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      assertEquals(started >= __jsxCacheInternals.SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY, true);
      assertEquals(
        peak <= __jsxCacheInternals.SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY,
        true,
        "scheduled maintenance must not scan more than eight directories at once",
      );
    } finally {
      releaseScans.resolve();
      localFs.readDir = originalReadDir;
      for (let attempt = 0; attempt < 100 && active > 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
  });

  it("retains a persisted request when its prune schedules a follow-up", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-jsx-persisted-follow-up-" });
    const sourcePath = "/tmp/source/PersistedFollowUp.tsx";
    const requestPrefix = `${tempDir}/`;
    try {
      await writeTextFile(
        join(tempDir, buildMdxJsxCacheFileName(sourcePath, "export const v = 1;")),
        "export const v = 1;",
      );
      const generation = await persistJsxCachePruneRequest(tempDir, Date.now());
      if (generation === undefined) throw new Error("failed to persist the test prune request");
      await promotePersistedJsxCachePruneRequest();
      await new Promise((resolve) => setTimeout(resolve, 10));

      assertEquals(await hasPersistedJsxCachePrune(tempDir), true);
      assertEquals(hasScheduledJsxCachePrune(tempDir), true);
    } finally {
      cancelScheduledJsxCachePrunes();
      await clearPersistedJsxCachePruneRequestsForTests(requestPrefix);
      await remove(tempDir, { recursive: true });
    }
  });

  it("locks malformed persisted requests through validation and removal", async () => {
    const directory = `${persistedTestPrefix}malformed`;
    const requestPath = await getPersistedJsxCachePruneRequestPath(directory);
    const localFs = getLocalFs();
    const originalReadTextFile = localFs.readTextFile.bind(localFs);
    const originalRemove = localFs.remove.bind(localFs);
    let readUnderLease = false;
    let removedUnderLease = false;

    try {
      await mkdir(dirname(requestPath), { recursive: true });
      await writeTextFile(requestPath, "{truncated");
      localFs.readTextFile = async (path) => {
        if (path === requestPath) {
          readUnderLease = await localFs.exists(`${requestPath}.lock`);
        }
        return await originalReadTextFile(path);
      };
      localFs.remove = async (path, options) => {
        if (path === requestPath) {
          removedUnderLease = await localFs.exists(`${requestPath}.lock`);
        }
        await originalRemove(path, options);
      };

      await promotePersistedJsxCachePruneRequest();

      assertEquals(readUnderLease, true);
      assertEquals(removedUnderLease, true);
      assertEquals(await localFs.exists(requestPath), false);
    } finally {
      localFs.readTextFile = originalReadTextFile;
      localFs.remove = originalRemove;
      await originalRemove(requestPath).catch(() => undefined);
      await originalRemove(`${requestPath}.lock`).catch(() => undefined);
    }
  });

  it("sweeps stale persisted-request lease tombstones", async () => {
    const directory = `${persistedTestPrefix}request-tombstone`;
    const requestPath = await getPersistedJsxCachePruneRequestPath(directory);
    const tombstonePath = `${requestPath}.lock.stale-11111111-1111-4111-8111-111111111111`;
    const localFs = getLocalFs();
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");

    try {
      await mkdir(dirname(requestPath), { recursive: true });
      await writeTextFile(tombstonePath, "abandoned-owner");
      const staleAt = new Date(
        Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1_000,
      );
      await utime(tombstonePath, staleAt, staleAt);

      await promotePersistedJsxCachePruneRequest();

      assertEquals(
        await localFs.exists(tombstonePath),
        false,
        "central request-lock debris must not accumulate outside project cache sweeps",
      );
    } finally {
      await localFs.remove(tombstonePath).catch(() => undefined);
    }
  });

  it("sweeps stale persisted-request lease transitions", async () => {
    const directory = `${persistedTestPrefix}request-transition`;
    const requestPath = await getPersistedJsxCachePruneRequestPath(directory);
    const transitionPath = `${requestPath}.lock.transition`;
    const localFs = getLocalFs();
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");

    try {
      await mkdir(dirname(requestPath), { recursive: true });
      await writeTextFile(transitionPath, "abandoned-owner");
      const staleAt = new Date(
        Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1_000,
      );
      await utime(transitionPath, staleAt, staleAt);

      await promotePersistedJsxCachePruneRequest();

      assertEquals(
        await localFs.exists(transitionPath),
        false,
        "central request transition fences must not accumulate",
      );
    } finally {
      await localFs.remove(transitionPath).catch(() => undefined);
    }
  });

  it("sweeps a stale persisted-request lock whose request was never written", async () => {
    const directory = `${persistedTestPrefix}orphan-request-lock`;
    const requestPath = await getPersistedJsxCachePruneRequestPath(directory);
    const lockPath = `${requestPath}.lock`;
    const localFs = getLocalFs();
    const utime = localFs.utime?.bind(localFs);
    if (!utime) throw new Error("the test runtime must support file timestamps");

    try {
      await mkdir(dirname(requestPath), { recursive: true });
      await writeTextFile(lockPath, "abandoned-owner");
      const staleAt = new Date(
        Date.now() - __jsxCacheInternals.JSX_ARTIFACT_LEASE_STALE_MS - 1_000,
      );
      await utime(lockPath, staleAt, staleAt);

      await promotePersistedJsxCachePruneRequest();

      assertEquals(
        await localFs.exists(lockPath),
        false,
        "a request writer that exits before creating JSON must not leak its lease",
      );
    } finally {
      await localFs.remove(lockPath).catch(() => undefined);
    }
  });

  it("promotes an earlier persisted request while queued work remains", async () => {
    await clearPersistedJsxCachePruneRequestsForTests(persistedTestPrefix);
    const persisted = `${persistedTestPrefix}persisted-earlier`;
    await persistJsxCachePruneRequest(persisted, Date.now() + 10_000);
    const trigger = `${persistedTestPrefix}trigger`;
    scheduleJsxCachePruneRetry(trigger, 0);
    for (let entry = 0; entry < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES - 1; entry++) {
      ensureJsxCacheSweepArmed(`${persistedTestPrefix}scheduled-${entry}`);
    }
    ensureJsxCacheSweepArmed(`${persistedTestPrefix}queued`);

    for (let attempt = 0; attempt < 100; attempt++) {
      if (hasScheduledJsxCachePrune(persisted)) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    assertEquals(
      hasScheduledJsxCachePrune(persisted),
      true,
      "an occupied queue must not starve earlier persisted work",
    );
  });

  it("retires only the persisted generation that completed", async () => {
    const directory = `${persistedTestPrefix}generation`;
    const firstGeneration = await persistJsxCachePruneRequest(directory, Date.now() + 20_000);
    const replacementGeneration = await persistJsxCachePruneRequest(directory, Date.now());
    if (firstGeneration === undefined || replacementGeneration === undefined) {
      throw new Error("failed to persist the test prune generations");
    }

    await retirePersistedJsxCachePruneRequest(directory, firstGeneration);
    assertEquals(
      await hasPersistedJsxCachePrune(directory),
      true,
      "a newer writer's cleanup request must survive older work completing",
    );

    await retirePersistedJsxCachePruneRequest(directory, replacementGeneration);
    assertEquals(await hasPersistedJsxCachePrune(directory), false);
  });

  it("retains overflow work after a transient persistence failure", async () => {
    const directory = `${persistedTestPrefix}retry-write`;
    const path = await getPersistedJsxCachePruneRequestPath(directory);
    const localFs = getLocalFs();
    const originalWrite = localFs.writeTextFile.bind(localFs);
    let failed = false;
    try {
      localFs.writeTextFile = (target, content) => {
        if (target === path && !failed) {
          failed = true;
          return Promise.reject(new Error("temporary write failure"));
        }
        return originalWrite(target, content);
      };
      for (let index = 0; index < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES * 2; index++) {
        ensureJsxCacheSweepArmed(`${persistedTestPrefix}retry-filler-${index}`);
      }
      ensureJsxCacheSweepArmed(directory);
      for (let attempt = 0; attempt < 250; attempt++) {
        if (await hasPersistedJsxCachePrune(directory)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assertEquals(failed, true);
      assertEquals(await hasPersistedJsxCachePrune(directory), true);
    } finally {
      localFs.writeTextFile = originalWrite;
    }
  });

  it("defers background promotion when every maintenance tier is full", async () => {
    const urgent = `${persistedTestPrefix}urgent-full`;
    await persistJsxCachePruneRequest(urgent, Date.now() + 10_000);
    const localFs = getLocalFs();
    const originalWrite = localFs.writeTextFile.bind(localFs);
    try {
      localFs.writeTextFile = (path, content) =>
        path.endsWith(".json")
          ? Promise.reject(new Error("temporary persistence failure"))
          : originalWrite(path, content);
      for (let index = 0; index < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES * 3; index++) {
        scheduleJsxCachePruneRetry(`${persistedTestPrefix}full-${index}`, 60_000);
      }
      ensureJsxCacheSweepArmed(`${persistedTestPrefix}full-767`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEquals(await hasPersistedJsxCachePrune(urgent), true);
      assertEquals(scheduledJsxCachePruneCount(), MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES);
    } finally {
      cancelScheduledJsxCachePrunes();
      localFs.writeTextFile = originalWrite;
    }
  });

  it("renews a persisted generation even when new work has a later deadline", async () => {
    const directory = `${persistedTestPrefix}later-generation`;
    const firstGeneration = await persistJsxCachePruneRequest(directory, Date.now());
    const replacementGeneration = await persistJsxCachePruneRequest(directory, Date.now() + 20_000);
    assertExists(firstGeneration);
    assertExists(replacementGeneration);
    assertNotEquals(firstGeneration, replacementGeneration);
    await retirePersistedJsxCachePruneRequest(directory, firstGeneration);
    assertEquals(await hasPersistedJsxCachePrune(directory), true);
    await retirePersistedJsxCachePruneRequest(directory, replacementGeneration);
    assertEquals(await hasPersistedJsxCachePrune(directory), false);
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
