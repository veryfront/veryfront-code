import { makeTempDir, mkdir, remove, stat, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { utimes as utime } from "node:fs/promises";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __importTransformerInternals } from "#veryfront/transforms/mdx/esm-module-loader/import-transformer.ts";
import { __moduleWriterInternals } from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { LazyJsxImportScope } from "#veryfront/transforms/mdx/esm-module-loader/lazy-jsx-imports.ts";
import {
  __jsxCacheInternals,
  JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS,
  resolveOwnedJsxArtifactPath,
  retainJsxArtifactsReferencedIn,
} from "#veryfront/transforms/mdx/esm-module-loader/jsx-cache.ts";
import { buildMdxJsxCacheFileName } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";

describe("MDX cache shared-realm lifecycle", () => {
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

  it("temporary-parent release failures do not skip later releases or mask the load error", async () => {
    const failure = new Error("fixture load failure");
    let released = 0;
    const observed = await (async () => {
      try {
        throw failure;
      } finally {
        await __moduleWriterInternals.releaseTemporaryParents([
          () => {
            released++;
            throw new Error("fixture prune capacity failure");
          },
          () => {
            released++;
            return Promise.resolve();
          },
        ]);
      }
    })().catch((error: unknown) => error);
    assertEquals(released, 2);
    assertEquals(observed, failure);
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
