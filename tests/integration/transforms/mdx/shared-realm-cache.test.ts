import { makeTempDir, mkdir, remove, stat, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { utimes as utime } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FRAMEWORK_ROOT } from "#veryfront/transforms/mdx/esm-module-loader/constants.ts";
import { getLocalFs } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { __moduleWriterInternals } from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";
import {
  primordialPromiseAll,
  primordialPromiseAllSettled,
  primordialPromiseCatch,
  primordialPromiseFinally,
  primordialPromiseReject,
  primordialPromiseResolve,
  primordialPromiseThen,
} from "#veryfront/platform/compat/primordials/promise.ts";
import { __importTransformerInternals } from "#veryfront/transforms/mdx/esm-module-loader/import-transformer.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { Semaphore as CacheSemaphore } from "#veryfront/utils/semaphore.ts";
import { LazyJsxImportScope } from "#veryfront/transforms/mdx/esm-module-loader/lazy-jsx-imports.ts";
import {
  __jsxCacheInternals,
  JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
  JsxCacheCapacityError,
  MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY,
  resolveOwnedJsxArtifactPath,
  retainJsxArtifactForImport,
  retainJsxArtifactsReferencedIn,
  withJsxArtifactLock,
  withJsxArtifactWriteCapacity,
} from "#veryfront/transforms/mdx/esm-module-loader/jsx-cache.ts";
import {
  buildMdxEsmPathCacheKey,
  buildMdxJsxCacheFileName,
  MDX_JSX_CACHE_NAMESPACE_PREFIX,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { utf8ByteLength } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/limits.ts";

type SourceSpanCounterOperation = "dynamic" | "side-effect" | "static";

function measureSourceSpanCalls(operation: SourceSpanCounterOperation): {
  calls: number;
  mode: SourceSpanCounterOperation;
  paths: string[];
  sourceLength: number;
} {
  const fixture = fileURLToPath(
    new URL("./fixtures/source-spans-complexity.mjs", import.meta.url),
  );
  const moduleUrl = new URL(
    "../../../../src/transforms/mdx/esm-module-loader/utils/source-spans.ts",
    import.meta.url,
  ).href;
  const runtimeArgs = "Deno" in globalThis
    ? ["run", "--config=deno.json", "-A", fixture]
    : "Bun" in globalThis
    ? ["--preload", "./tests/bun/preload.ts", fixture]
    : ["--import", "./tests/node/resolver.mjs", fixture];
  const result = spawnSync(process.execPath, runtimeArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      VERYFRONT_TEST_SOURCE_SPANS_MODE: operation,
      VERYFRONT_TEST_SOURCE_SPANS_URL: moduleUrl,
    },
  });
  if (result.status !== 0) {
    throw new Error(`Source-span counter failed: ${result.stderr || result.stdout}`);
  }
  const match = /{"mode":[^\n]+}/.exec(result.stdout);
  if (!match) throw new Error("Source-span counter produced no result");
  return JSON.parse(match[0]);
}

// Real filesystem, native module loading, and process-wide prototype mutation
// require the integration lane under the semantic unit-boundary audit.
describe("MDX cache shared-realm lifecycle", () => {
  it("measures bounded static JSX lookahead in a fresh runtime", () => {
    const repeated = Array.from(
      { length: 3_000 },
      (_, index) => `const value${index} = <Type${index}>input${index};`,
    ).join("\n");
    const source = `${repeated}\nimport real from "./real.js";`;
    const measured = measureSourceSpanCalls("static");
    assertEquals(measured.mode, "static");
    assertEquals(measured.paths, ["./real.js"]);
    assertEquals(measured.calls > 0, true);
    assertEquals(measured.calls < source.length * 3, true);
    assertEquals(measured.sourceLength, source.length);
  });

  it("measures bounded side-effect JSX lookahead in a fresh runtime", () => {
    const repeated = Array.from(
      { length: 3_000 },
      (_, index) => `const value${index} = <Type${index}>input${index};`,
    ).join("\n");
    const source = `${repeated}\nimport "./real.js";`;
    const measured = measureSourceSpanCalls("side-effect");
    assertEquals(measured.mode, "side-effect");
    assertEquals(measured.paths, ["./real.js"]);
    assertEquals(measured.calls > 0, true);
    assertEquals(measured.calls < source.length * 3, true);
    assertEquals(measured.sourceLength, source.length);
  });

  it("measures bounded TypeScript assertion lookahead in a fresh runtime", () => {
    const source = "type Value = unknown;\nconst values = [" +
      Array.from({ length: 8_000 }, (_, index) => `<T${index}>value`).join(",") + "];";
    const measured = measureSourceSpanCalls("dynamic");
    assertEquals(measured.mode, "dynamic");
    assertEquals(measured.paths, []);
    assertEquals(measured.calls > 0, true);
    assertEquals(measured.calls < source.length, true);
    assertEquals(measured.sourceLength, source.length);
  });

  it("classifies private framework roots without live array or string predicates", () => {
    const some = Array.prototype.some;
    const startsWith = String.prototype.startsWith;
    let framework = false;
    let project = true;
    try {
      Array.prototype.some = () => {
        throw new Error("replaced Array.some");
      };
      String.prototype.startsWith = () => {
        throw new Error("replaced String.startsWith");
      };
      framework = __importTransformerInternals.isFrameworkSourceFile(
        `${FRAMEWORK_ROOT}/src/react/components/Head.tsx`,
      );
      project = __importTransformerInternals.isFrameworkSourceFile(
        `${FRAMEWORK_ROOT}/projects/mine/components/Card.tsx`,
      );
    } finally {
      Array.prototype.some = some;
      String.prototype.startsWith = startsWith;
    }
    assertEquals(framework, true);
    assertEquals(project, false);
  });

  it("keeps byte admission and cache variants independent of mutable primitives", () => {
    const encode = TextEncoder.prototype.encode;
    const byteLength = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "byteLength");
    const startsWith = String.prototype.startsWith;
    let encodedLength = 0;
    let variantKey = "";
    try {
      TextEncoder.prototype.encode = () => {
        throw new Error("replaced TextEncoder.encode");
      };
      Object.defineProperty(Uint8Array.prototype, "byteLength", {
        configurable: true,
        get() {
          throw new Error("replaced Uint8Array.byteLength");
        },
      });
      String.prototype.startsWith = () => {
        throw new Error("replaced String.startsWith");
      };
      encodedLength = utf8ByteLength("é");
      variantKey = buildMdxEsmPathCacheKey("/project/Card.tsx", "19.1.1", "on:compile-dev");
    } finally {
      TextEncoder.prototype.encode = encode;
      if (byteLength) Object.defineProperty(Uint8Array.prototype, "byteLength", byteLength);
      else delete (Uint8Array.prototype as unknown as { byteLength?: number }).byteLength;
      String.prototype.startsWith = startsWith;
    }
    assertEquals(encodedLength, 2);
    assertEquals(variantKey.includes(":on:compile-dev:"), true);
  });

  it("routes framework source locally and project source through the bounded adapter", async () => {
    const projectDir = `${FRAMEWORK_ROOT}/projects/routing-fixture`;
    const projectPath = `${projectDir}/Card.tsx`;
    const frameworkPath = `${FRAMEWORK_ROOT}/src/transforms/mdx/esm-module-loader/constants.ts`;
    let adapterReads = 0;
    let localReads = 0;
    const localFs = getLocalFs();
    const readLocal = localFs.readTextFile.bind(localFs);
    const adapter = {
      fs: {
        readFile: (path: string) => {
          adapterReads++;
          if (path !== projectPath) throw new Error(`unexpected adapter read: ${path}`);
          return Promise.resolve("export const Card = () => <div />;");
        },
      },
    } as unknown as RuntimeAdapter;
    try {
      localFs.readTextFile = (path) => {
        localReads++;
        if (path !== frameworkPath) throw new Error(`unexpected local read: ${path}`);
        return Promise.resolve("export const Framework = true;");
      };
      await __importTransformerInternals.readJsxImportSource(frameworkPath, adapter, projectDir);
      await __importTransformerInternals.readJsxImportSource(projectPath, adapter, projectDir);
    } finally {
      localFs.readTextFile = readLocal;
    }
    assertEquals(adapterReads, 1);
    assertEquals(localReads, 1);
  });

  it("the cache semaphore preserves queued work and permits after queue methods are replaced", async () => {
    const semaphore = new CacheSemaphore(1, { acquireTimeoutMs: 100 });
    const queue = Object.getOwnPropertyDescriptor(semaphore, "waiting")!.value;
    const shift = Array.prototype.shift;
    const push = Array.prototype.push;
    const barrier = Promise.withResolvers<void>();
    const first = semaphore.acquire(async () => {
      await barrier.promise;
      return 1;
    });
    await Promise.resolve();
    let results: PromiseSettledResult<number>[] = [];
    try {
      Array.prototype.shift = function () {
        if (this === queue) return { resolve: () => {} };
        return shift.call(this);
      };
      Array.prototype.push = function (...items) {
        if (this === queue) throw new Error("fixture replaced queue push");
        return Reflect.apply(push, this, items);
      };
      const second = semaphore.acquire(async () => 2);
      barrier.resolve();
      results = await Promise.allSettled([first, second]);
    } finally {
      Array.prototype.shift = shift;
      Array.prototype.push = push;
      barrier.resolve();
      await first;
    }
    assertEquals(results, [{ status: "fulfilled", value: 1 }, { status: "fulfilled", value: 2 }]);
    assertEquals(semaphore.active, 0);
    assertEquals(semaphore.waitingCount, 0);
  });

  it("cache semaphore timeout cleanup does not consult Array species", async () => {
    const semaphore = new CacheSemaphore(1, { acquireTimeoutMs: 5 });
    const barrier = Promise.withResolvers<void>();
    const blocking = semaphore.acquire(async () => {
      await barrier.promise;
    });
    await Promise.resolve();
    const species = Object.getOwnPropertyDescriptor(Array, Symbol.species);
    let timedOut = false;
    let waiting = -1;
    try {
      Object.defineProperty(Array, Symbol.species, {
        configurable: true,
        get() {
          if (new Error().stack?.includes("/primordials/array.ts")) {
            throw new Error("fixture replaced Array species");
          }
          return Array;
        },
      });
      try {
        await semaphore.acquire(async () => undefined);
      } catch {
        timedOut = true;
      }
      waiting = semaphore.waitingCount;
    } finally {
      if (species) Object.defineProperty(Array, Symbol.species, species);
      else delete (Array as unknown as Record<PropertyKey, unknown>)[Symbol.species];
      barrier.resolve();
      await blocking;
    }
    assertEquals(timedOut, true);
    assertEquals(waiting, 0);
  });

  it("SSR semaphore abort cleanup does not consult Array species", async () => {
    const semaphore = new Semaphore(1);
    const controller = new AbortController();
    await semaphore.tryAcquire();
    const species = Object.getOwnPropertyDescriptor(Array, Symbol.species);
    let aborted = false;
    let waiting = -1;
    try {
      Object.defineProperty(Array, Symbol.species, {
        configurable: true,
        get() {
          if (new Error().stack?.includes("/primordials/array.ts")) {
            throw new Error("fixture replaced Array species");
          }
          return Array;
        },
      });
      const pending = semaphore.tryAcquire(500, { signal: controller.signal });
      controller.abort(new DOMException("species abort", "AbortError"));
      try {
        await pending;
      } catch {
        aborted = true;
      }
      waiting = semaphore.waiting;
    } finally {
      if (species) Object.defineProperty(Array, Symbol.species, species);
      else delete (Array as unknown as Record<PropertyKey, unknown>)[Symbol.species];
      semaphore.release();
    }
    assertEquals(aborted, true);
    assertEquals(waiting, 0);
    assertEquals(semaphore.available, 1);
  });

  it("temporary-parent removal releases its pin after Promise.catch is replaced", async () => {
    const dir = await makeTempDir();
    const path = dir + "/" +
      buildMdxJsxCacheFileName("/project/Parent.tsx", "export const value = 67;");
    const originalCatch = Promise.prototype.catch;
    let pins = -1;
    try {
      await writeTextFile(path, "export const value = 67;");
      const release = await __moduleWriterInternals.retainTemporaryParent(path, dir);
      Promise.prototype.catch = () => {
        throw new Error("fixture replaced Promise.catch");
      };
      await release();
      pins = __jsxCacheInternals.jsxArtifactActiveRefCount(path);
    } finally {
      Promise.prototype.catch = originalCatch;
      __jsxCacheInternals.releaseJsxArtifact(path);
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await __jsxCacheInternals.waitForJsxCacheMaintenanceForTests();
      await remove(dir, { recursive: true });
    }
    assertEquals(pins, 0);
  });

  it("preserves values, rejection, and cleanup without mutable Promise dispatch", async () => {
    // Let the test runner attach its own continuation before replacing methods.
    await primordialPromiseResolve();
    const originals = {
      resolve: Promise.resolve,
      reject: Promise.reject,
      all: Promise.all,
      allSettled: Promise.allSettled,
      then: Promise.prototype.then,
      catch: Promise.prototype.catch,
      finally: Promise.prototype.finally,
    };
    const failure = new Error("fixture rejection");
    const poison = () => {
      throw new Error("fixture replaced Promise operation");
    };
    let cleanupCount = 0;
    let values: unknown;
    let outcomes: unknown;
    let recovered: unknown;
    try {
      Promise.resolve = poison;
      Promise.reject = poison;
      Promise.all = poison;
      Promise.allSettled = poison;
      Promise.prototype.then = poison;
      Promise.prototype.catch = poison;
      Promise.prototype.finally = poison;
      values = await primordialPromiseAll([
        primordialPromiseThen(primordialPromiseResolve(2), async (value) => value + 1),
        4,
      ]);
      outcomes = await primordialPromiseAllSettled([
        primordialPromiseFinally(primordialPromiseResolve(5), () => {
          cleanupCount++;
        }),
        primordialPromiseFinally(primordialPromiseReject(failure), () => {
          cleanupCount++;
        }),
      ]);
      recovered = await primordialPromiseCatch(primordialPromiseReject(failure), () => 6);
    } finally {
      Promise.resolve = originals.resolve;
      Promise.reject = originals.reject;
      Promise.all = originals.all;
      Promise.allSettled = originals.allSettled;
      Promise.prototype.then = originals.then;
      Promise.prototype.catch = originals.catch;
      Promise.prototype.finally = originals.finally;
    }
    assertEquals(values, [3, 4]);
    assertEquals(outcomes, [
      { status: "fulfilled", value: 5 },
      { status: "rejected", reason: failure },
    ]);
    assertEquals(recovered, 6);
    assertEquals(cleanupCount, 2);
  });
  it("artifact leases and maintenance do not dispatch replaced Promise operations", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 61;";
    const artifact = dir + "/" + buildMdxJsxCacheFileName("/project/Promises.tsx", source);
    const stale = dir + "/" + buildMdxJsxCacheFileName("/project/StalePromises.tsx", source);
    const originals = {
      resolve: Promise.resolve,
      all: Promise.all,
      allSettled: Promise.allSettled,
      then: Promise.prototype.then,
      catch: Promise.prototype.catch,
      finally: Promise.prototype.finally,
    };
    let completed = false;
    let freshExists = false;
    let staleExists = true;
    let phase = "lock";
    const poison = () => {
      throw new Error(`fixture replaced Promise operation during ${phase}`);
    };
    const guarded = <T>(original: T): T =>
      function (this: unknown, ...args: unknown[]) {
        const caller = new Error().stack?.split("\n")[2] ?? "";
        if (
          caller.includes("jsx-cache.ts:") || caller.includes("import-transformer.ts:") ||
          caller.includes("semaphore.ts:") || caller.includes("compat/fs.ts:")
        ) return poison();
        return Reflect.apply(original as (...args: unknown[]) => unknown, this, args);
      } as T;
    try {
      await writeTextFile(artifact, source);
      await writeTextFile(stale, source);
      const old = new Date(Date.now() - 2 * JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS);
      await utime(stale, old, old);
      // Artifact preparation loads the native adapter before project evaluation.
      await withJsxArtifactLock(artifact, async () => {});
      // Native filesystem internals also dispatch Promise methods. Target direct
      // framework calls here; the pure helper test poisons every dispatch above.
      Promise.resolve = guarded(originals.resolve);
      Promise.all = guarded(originals.all);
      Promise.allSettled = guarded(originals.allSettled);
      Promise.prototype.then = guarded(originals.then);
      Promise.prototype.catch = guarded(originals.catch);
      Promise.prototype.finally = guarded(originals.finally);
      await withJsxArtifactLock(artifact, async () => {
        completed = true;
      });
      phase = "retention";
      const release = await retainJsxArtifactForImport(artifact);
      release();
      phase = "maintenance";
      await __jsxCacheInternals.collectExcessJsxArtifacts(dir, new Map(), Date.now());
      await __jsxCacheInternals.revisitJsxCacheDirectory(dir);
    } catch (error) {
      throw new Error(`Promise fixture failed during ${phase}`, { cause: error });
    } finally {
      Promise.resolve = originals.resolve;
      Promise.all = originals.all;
      Promise.allSettled = originals.allSettled;
      Promise.prototype.then = originals.then;
      Promise.prototype.catch = originals.catch;
      Promise.prototype.finally = originals.finally;
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await __jsxCacheInternals.waitForJsxCacheMaintenanceForTests();
      try {
        freshExists = await stat(artifact).then(() => true, () => false);
        staleExists = await stat(stale).then(() => true, () => false);
      } finally {
        await remove(dir, { recursive: true });
      }
    }
    assertEquals(completed, true);
    assertEquals(freshExists, true);
    assertEquals(staleExists, false);
  });

  it("cache filenames remain stable when hash and padding intrinsics are replaced", () => {
    const path = "fixtures/project/Value.tsx";
    const source = "export const value = 53;";
    const expected = buildMdxJsxCacheFileName(path, source);
    const padStart = String.prototype.padStart;
    const charCodeAt = String.prototype.charCodeAt;
    const numberToString = Number.prototype.toString;
    const imul = Math.imul;
    let observed: string;
    try {
      String.prototype.padStart = () => "/../";
      String.prototype.charCodeAt = () => 0;
      Number.prototype.toString = () => "/../";
      Math.imul = () => 0;
      observed = buildMdxJsxCacheFileName(path, source);
    } finally {
      String.prototype.padStart = padStart;
      String.prototype.charCodeAt = charCodeAt;
      Number.prototype.toString = numberToString;
      Math.imul = imul;
    }
    assertEquals(observed, expected);
  });

  it("delayed native imports settle while the lexer array iterator remains replaced", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 59;";
    const artifact = dir + "/" + buildMdxJsxCacheFileName("/project/Delayed.tsx", source);
    const parent = dir + "/parent.mjs";
    const scope = new LazyJsxImportScope();
    const iterator = Array.prototype[Symbol.iterator];
    let value: unknown;
    try {
      await writeTextFile(artifact, source);
      await writeTextFile(
        parent,
        await scope.rewrite(
          `export const load = () => import(${JSON.stringify("file://" + artifact)});`,
          dir,
        ),
      );
      const module = await import("file://" + parent);
      scope.release();
      Array.prototype[Symbol.iterator] = function () {
        if (Array.isArray(this[0])) throw new Error("fixture replaced lexer array iterator");
        return iterator.call(this);
      };
      value = (await module.load()).value;
    } finally {
      Array.prototype[Symbol.iterator] = iterator;
      scope.release();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await __jsxCacheInternals.waitForJsxCacheMaintenanceForTests();
      await remove(dir, { recursive: true });
    }
    assertEquals(value, 59);
  });

  it("subsequent lazy rewrites settle while parsed-import iteration remains replaced", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 61;";
    const artifact = dir + "/" + buildMdxJsxCacheFileName("/project/Subsequent.tsx", source);
    const artifactUrl = pathToFileURL(artifact).href;
    const scope = new LazyJsxImportScope();
    const iterator = Array.prototype[Symbol.iterator];
    let rewritten = "";
    try {
      await writeTextFile(artifact, source);
      Array.prototype[Symbol.iterator] = function () {
        const first = this[0];
        if (
          Array.isArray(first) ||
          (first !== null && typeof first === "object" && "ss" in first)
        ) {
          throw new Error("fixture replaced parsed-import iterator");
        }
        return Reflect.apply(iterator, this, []);
      };
      rewritten = await scope.rewrite(
        `export const load = () => import("${artifactUrl}");`,
        dir,
      );
    } finally {
      Array.prototype[Symbol.iterator] = iterator;
      scope.release();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
    assertEquals(rewritten.includes("_bridge"), true);
  });

  it("subsequent lazy rewrites preserve source ranges after String.slice is replaced", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 62;";
    const artifact = dir + "/" + buildMdxJsxCacheFileName("/project/StringRange.tsx", source);
    const artifactUrl = pathToFileURL(artifact).href;
    const scope = new LazyJsxImportScope();
    const slice = String.prototype.slice;
    const replace = String.prototype.replace;
    const replaceAll = String.prototype.replaceAll;
    const substring = String.prototype.substring;
    const regexpExec = RegExp.prototype.exec;
    const regexpReplace = RegExp.prototype[Symbol.replace];
    let rewritten = "";
    try {
      await writeTextFile(artifact, source);
      String.prototype.slice = function (...args) {
        if (new Error().stack?.split("\n")[2]?.includes("/lazy-jsx-imports.ts")) {
          throw new Error("fixture replaced String.slice");
        }
        return Reflect.apply(slice, this, args);
      };
      String.prototype.replace = () => {
        throw new Error("fixture replaced String.replace");
      };
      String.prototype.replaceAll = () => {
        throw new Error("fixture replaced String.replaceAll");
      };
      String.prototype.substring = () => {
        throw new Error("fixture replaced String.substring");
      };
      RegExp.prototype[Symbol.replace] = () => {
        throw new Error("fixture replaced RegExp Symbol.replace");
      };
      RegExp.prototype.exec = () => {
        throw new Error("fixture replaced RegExp exec");
      };
      rewritten = await scope.rewrite(
        `export const before = "https://example.com/a.js"; export const load = () => import("${artifactUrl}"); export const after = 2;`,
        dir,
      );
    } finally {
      String.prototype.slice = slice;
      String.prototype.replace = replace;
      String.prototype.replaceAll = replaceAll;
      String.prototype.substring = substring;
      RegExp.prototype.exec = regexpExec;
      RegExp.prototype[Symbol.replace] = regexpReplace;
      scope.release();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
    assertEquals(rewritten.includes('export const before = "https://example.com/a.js"'), true);
    assertEquals(rewritten.includes("export const after = 2"), true);
  });

  it("lazy retention and pruning do not consult Array species", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 63;";
    const artifact = dir + "/" + buildMdxJsxCacheFileName("/project/Species.tsx", source);
    const species = Object.getOwnPropertyDescriptor(Array, Symbol.species);
    let release: (() => void) | undefined;
    try {
      await writeTextFile(artifact, source);
      Object.defineProperty(Array, Symbol.species, {
        configurable: true,
        get() {
          if (new Error().stack?.includes("/primordials/array.ts")) {
            throw new Error("fixture replaced Array species");
          }
          return Array;
        },
      });
      release = await retainJsxArtifactsReferencedIn(
        `export const load = () => import(${JSON.stringify("file://" + artifact)});`,
        dir,
      );
      await __jsxCacheInternals.runLazyJsxArtifactHeartbeat();
      release();
      release = undefined;
      await __jsxCacheInternals.revisitJsxCacheDirectory(dir);
      assertEquals(await stat(artifact).then(() => true, () => false), true);
    } finally {
      if (species) Object.defineProperty(Array, Symbol.species, species);
      else delete (Array as unknown as Record<PropertyKey, unknown>)[Symbol.species];
      release?.();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
  });

  it("quota admission counts real artifacts when string predicates are replaced", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 47;";
    const startsWith = String.prototype.startsWith;
    const endsWith = String.prototype.endsWith;
    let admitted = false;
    let failure: unknown;
    try {
      for (let index = 0; index < MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY; index++) {
        await writeTextFile(
          dir + "/" + buildMdxJsxCacheFileName(`/project/${index}.tsx`, source),
          source,
        );
      }
      const next = dir + "/" + buildMdxJsxCacheFileName("/project/Next.tsx", source);
      try {
        String.prototype.startsWith = function (search, position) {
          return search === MDX_JSX_CACHE_NAMESPACE_PREFIX
            ? false
            : startsWith.call(this, search, position);
        };
        String.prototype.endsWith = function (search, end) {
          return search === ".mjs" ? false : endsWith.call(this, search, end);
        };
        failure = await withJsxArtifactWriteCapacity(dir, next, () => {
          admitted = true;
          return Promise.resolve();
        }).catch((error: unknown) => error);
      } finally {
        String.prototype.startsWith = startsWith;
        String.prototype.endsWith = endsWith;
      }
      assertEquals(admitted, false);
      assertEquals(failure instanceof JsxCacheCapacityError, true);
    } finally {
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
  });

  it("scheduled maintenance trusts host time and preserves a freshly refreshed remote artifact", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 53;";
    const fresh = dir + "/" + buildMdxJsxCacheFileName("/project/Fresh.tsx", source);
    const stale = dir + "/" + buildMdxJsxCacheFileName("/project/Stale.tsx", source);
    const now = Date.now;
    try {
      await writeTextFile(fresh, source);
      await writeTextFile(stale, source);
      const old = new Date(now() - 2 * JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS);
      await utime(stale, old, old);
      try {
        Date.now = () => Infinity;
        await __jsxCacheInternals.revisitJsxCacheDirectory(dir);
      } finally {
        Date.now = now;
      }
      assertEquals(await stat(fresh).then(() => true, () => false), true);
      assertEquals(await stat(stale).then(() => true, () => false), false);
    } finally {
      Date.now = now;
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
  });

  it("maintenance keeps trusted arithmetic, timestamps, lease patterns, and encoding", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 59;";
    const fresh = dir + "/" + buildMdxJsxCacheFileName("/project/Fresh.tsx", source);
    const stale = dir + "/" + buildMdxJsxCacheFileName("/project/Stale.tsx", source);
    const tombstone = dir + "/jsx-orphan.mjs.lock.release-" + crypto.randomUUID();
    const min = Math.min;
    const max = Math.max;
    const getTime = Date.prototype.getTime;
    const exec = RegExp.prototype.exec;
    const encode = TextEncoder.prototype.encode;
    try {
      await writeTextFile(fresh, source);
      await writeTextFile(stale, source);
      await writeTextFile(tombstone, "fixture lease owner");
      const old = new Date(Date.now() - 2 * JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS);
      await utime(stale, old, old);
      await utime(tombstone, old, old);
      try {
        Math.min = () => 0;
        Math.max = () => Infinity;
        Date.prototype.getTime = () => 0;
        RegExp.prototype.exec = () => null;
        TextEncoder.prototype.encode = () => new Uint8Array();
        await __jsxCacheInternals.revisitJsxCacheDirectory(dir);
      } finally {
        Math.min = min;
        Math.max = max;
        Date.prototype.getTime = getTime;
        RegExp.prototype.exec = exec;
        TextEncoder.prototype.encode = encode;
      }
      assertEquals(await stat(fresh).then(() => true, () => false), true);
      assertEquals(await stat(stale).then(() => true, () => false), false);
      assertEquals(await stat(tombstone).then(() => true, () => false), false);
    } finally {
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
  });

  it("lazy imports capture option intrinsics before project callbacks run", async () => {
    const dir = await makeTempDir();
    const source = "export const value = 43;";
    const artifact = dir + "/" + buildMdxJsxCacheFileName("/project/Options.tsx", source);
    const parent = dir + "/parent.mjs";
    const scope = new LazyJsxImportScope();
    const entries = Object.entries;
    const create = Object.create;
    try {
      await writeTextFile(artifact, source);
      await writeTextFile(
        parent,
        await scope.rewrite(
          `export const load = (options) => import(${
            JSON.stringify("file://" + artifact)
          }, options);`,
          dir,
        ),
      );
      const module = await import("file://" + parent);
      scope.release();
      let pending: Promise<{ value: number }>;
      try {
        Object.entries = () => {
          throw new Error("tenant replaced Object.entries");
        };
        Object.create = () => {
          throw new Error("tenant replaced Object.create");
        };
        pending = module.load({ with: {} });
      } finally {
        Object.entries = entries;
        Object.create = create;
      }
      assertEquals((await pending).value, 43);
    } finally {
      Object.entries = entries;
      Object.create = create;
      scope.release();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
  });

  it("transform failure cleanup drains active work despite array replacement", async () => {
    const push = Array.prototype.push;
    const iterator = Array.prototype[Symbol.iterator];
    const failure = new Error("fixture transform failure");
    let finish!: () => void;
    const active = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let drained = false;
    let cleaned = false;
    let observed: unknown;
    try {
      const result = __importTransformerInternals.mapJsxTransformsWithCleanup(
        [0, 1],
        async (item) => {
          if (item === 0) {
            await active;
            drained = true;
            return item;
          }
          Array.prototype.push = function (...values) {
            if (values[0] instanceof Promise) throw new Error("tenant replaced promise array push");
            return Reflect.apply(push, this, values);
          };
          Array.prototype[Symbol.iterator] = function () {
            if (this[0] instanceof Promise) {
              throw new Error("tenant replaced promise array iterator");
            }
            return iterator.call(this);
          };
          throw failure;
        },
        () => {
          cleaned = drained;
          return Promise.resolve();
        },
        { semaphore: new Semaphore(2) },
      ).catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 10));
      finish();
      observed = await result;
    } finally {
      Array.prototype.push = push;
      Array.prototype[Symbol.iterator] = iterator;
      finish();
    }
    assertEquals(observed, failure);
    assertEquals(cleaned, true);
  });

  it("snapshot serialization does not expose private source through inherited hooks", async () => {
    const dir = await makeTempDir();
    const source = "export const fixtureValue = 42;";
    const path = dir + "/" + buildMdxJsxCacheFileName("/project/Fixture.tsx", source);
    const scope = new LazyJsxImportScope();
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    let exposed = false;
    try {
      await writeTextFile(path, source);
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value: function () {
          if (this[0] === path && this[1] === source) exposed = true;
          return this;
        },
      });
      await scope.rewrite(
        `export const load = () => import(${JSON.stringify("file://" + path)});`,
        dir,
      );
    } finally {
      if (previous) Object.defineProperty(Array.prototype, "toJSON", previous);
      else delete (Array.prototype as unknown as { toJSON?: unknown }).toJSON;
      scope.release();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
    assertEquals(exposed, false);
  });

  it("retention does not mutate a foreign path when startsWith is replaced", async () => {
    const dir = await makeTempDir();
    const path = dir + "/jsx-foreign.mjs";
    const cacheDir = dir + "/cache";
    const original = String.prototype.startsWith;
    let release: (() => void) | undefined;
    let admitted: string | undefined;
    let changed = false;
    try {
      await mkdir(cacheDir);
      await writeTextFile(path, "export const fixtureValue = 7;");
      await utime(path, new Date(0), new Date(0));
      String.prototype.startsWith = function (search: string, position?: number) {
        if (String(this) === path && search === cacheDir + "/") return true;
        return original.call(this, search, position);
      };
      admitted = resolveOwnedJsxArtifactPath("file://" + path, cacheDir);
      release = await retainJsxArtifactsReferencedIn(
        `import ${JSON.stringify("file://" + path)};`,
        cacheDir,
      );
      changed = ((await stat(path)).mtime?.getTime() ?? 0) > 0;
    } finally {
      String.prototype.startsWith = original;
      release?.();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
    assertEquals(changed, false);
    assertEquals(admitted, undefined);
  });

  it("sweeps preserve legacy readers beyond the idle horizon until an operator drains them", async () => {
    const dir = await makeTempDir();
    const path = dir + "/jsx-preheartbeat-fixture.mjs";
    const parent = dir + "/parent.mjs";
    try {
      await writeTextFile(path, "export const fixtureValue = 29;");
      const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
      await utime(path, old, old);
      await writeTextFile(
        parent,
        `export const load = () => import(${JSON.stringify("file://" + path)});`,
      );
      await __jsxCacheInternals.collectExcessJsxArtifacts(dir, new Map(), Date.now());
      const module = await import("file://" + parent);
      assertEquals((await module.load()).fixtureValue, 29);
      await __jsxCacheInternals.collectExcessJsxArtifacts(
        dir,
        new Map(),
        Date.now() + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS + 60_000,
      );
      assertEquals(await stat(path).then(() => true, () => false), true);
      assertEquals((await module.load()).fixtureValue, 29);
    } finally {
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      await remove(dir, { recursive: true });
    }
  });

  it("lazy heartbeat and release tolerate replaced array methods and iteration", async () => {
    const dir = await makeTempDir();
    const source = "export const fixtureValue = 31;";
    const path = dir + "/" + buildMdxJsxCacheFileName("/project/ArrayFixture.tsx", source);
    const stalePath = dir + "/" +
      buildMdxJsxCacheFileName("/project/StaleArrayFixture.tsx", source);
    const push = Array.prototype.push;
    const sort = Array.prototype.sort;
    const iterator = Array.prototype[Symbol.iterator];
    const from = Array.from;
    let poisonedCall = "";
    let release: (() => void) | undefined;
    try {
      await writeTextFile(path, source);
      await writeTextFile(stalePath, source);
      const old = new Date(Date.now() - 2 * JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS);
      await utime(stalePath, old, old);
      release = await retainJsxArtifactsReferencedIn(
        `export const load = () => import(${JSON.stringify("file://" + path)});`,
        dir,
      );
      const poison = () => {
        poisonedCall ||= new Error("array dispatch").stack ?? "array dispatch";
        throw new Error("tenant replaced an array intrinsic");
      };
      Array.from = () => [];
      const isCacheValue = (first: unknown) =>
        first === path || first === stalePath || Array.isArray(first) ||
        first instanceof Promise || typeof first === "function" ||
        (first !== null && typeof first === "object" &&
          ("name" in first || "path" in first || "timer" in first));
      Array.prototype.push = function (...items) {
        if (isCacheValue(this[0]) || isCacheValue(items[0])) return poison();
        return Reflect.apply(push, this, items);
      };
      Array.prototype.sort = function (compare) {
        if (isCacheValue(this[0])) return poison();
        return Reflect.apply(sort, this, [compare]);
      };
      // Deno's own error construction also spreads arrays. Target cache-owned
      // arrays so a missing lease file remains a normal host filesystem error.
      Array.prototype[Symbol.iterator] = function () {
        if (isCacheValue(this[0])) return poison();
        return iterator.call(this);
      };
      await __jsxCacheInternals.runLazyJsxArtifactHeartbeat();
      release();
      release = undefined;
      __jsxCacheInternals.scheduleJsxCachePruneRetry(dir, 0);
      for (
        let attempt = 0;
        attempt < 100 && await stat(stalePath).then(() => true, () => false);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await __jsxCacheInternals.collectExcessJsxArtifacts(dir, new Map(), Date.now());
    } finally {
      Array.prototype.push = push;
      Array.prototype.sort = sort;
      Array.prototype[Symbol.iterator] = iterator;
      Array.from = from;
      release?.();
      __jsxCacheInternals.cancelScheduledJsxCachePrunes();
      try {
        assertEquals(poisonedCall, "");
        assertEquals(await stat(stalePath).then(() => true, () => false), false);
      } finally {
        await remove(dir, { recursive: true });
      }
    }
  });
});
