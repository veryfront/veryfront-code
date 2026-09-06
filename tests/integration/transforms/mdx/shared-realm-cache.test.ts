import { makeTempDir, mkdir, remove, stat, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { utimes as utime } from "node:fs/promises";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __importTransformerInternals } from "#veryfront/transforms/mdx/esm-module-loader/import-transformer.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { LazyJsxImportScope } from "#veryfront/transforms/mdx/esm-module-loader/lazy-jsx-imports.ts";
import {
  __jsxCacheInternals,
  JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
  JsxCacheCapacityError,
  MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY,
  resolveOwnedJsxArtifactPath,
  retainJsxArtifactsReferencedIn,
  withJsxArtifactWriteCapacity,
} from "#veryfront/transforms/mdx/esm-module-loader/jsx-cache.ts";
import {
  buildMdxJsxCacheFileName,
  MDX_JSX_CACHE_NAMESPACE_PREFIX,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";

// Real filesystem, native module loading, and process-wide prototype mutation
// require the integration lane under the semantic unit-boundary audit.
describe("MDX cache shared-realm lifecycle", () => {
  it("cache filenames remain stable when padding is replaced with traversal segments", () => {
    const path = "fixtures/project/Value.tsx";
    const source = "export const value = 53;";
    const expected = buildMdxJsxCacheFileName(path, source);
    const padStart = String.prototype.padStart;
    let observed: string;
    try {
      String.prototype.padStart = () => "/../";
      observed = buildMdxJsxCacheFileName(path, source);
    } finally {
      String.prototype.padStart = padStart;
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
