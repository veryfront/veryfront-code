import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { buildMdxJsxCacheFileName } from "./cache-format.ts";
import { __jsxCacheInternals } from "./jsx-cache.ts";
import { LazyJsxImportScope } from "./lazy-jsx-imports.ts";
import { getLocalFs } from "./cache/index.ts";
import { MAX_MDX_MODULE_CODE_BYTES, ModuleSourceLimitError } from "./module-fetcher/limits.ts";

function bridgeSize(): number {
  const key = Symbol.for("veryfront.mdx.lazy-jsx-imports.v1");
  return (globalThis as typeof globalThis & { [key]: Map<string, unknown> })[key].size;
}

describe("lazy JSX regeneration", () => {
  afterEach(() => __jsxCacheInternals.cancelScheduledJsxCachePrunes());

  it("restores the original artifact after eviction and parent-scope release", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-regeneration-" });
    const source = "export const value = 42;";
    const artifact = join(dir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const scope = new LazyJsxImportScope();
    const initialSize = bridgeSize();
    try {
      await writeTextFile(artifact, source);
      const code = await scope.rewrite(
        `export const load = () => import(${JSON.stringify(`file://${artifact}`)});`,
        dir,
      );
      const parent = join(dir, "parent.mjs");
      await writeTextFile(parent, code);
      const module = await import(`file://${parent}`);
      scope.release();
      scope.release();
      assertEquals(bridgeSize(), initialSize);
      await remove(artifact);
      assertEquals((await module.load()).value, 42);
      assertEquals(await readTextFile(artifact), source);
      await remove(artifact);
      assertEquals((await module.load()).value, 42);
      assertEquals(await readTextFile(artifact), source);
    } finally {
      scope.release();
      await remove(dir, { recursive: true });
    }
  });

  it("shares concurrent parent registrations without releasing another parent's callback", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-concurrent-" });
    const source = "export const value = 7;";
    const artifact = join(dir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const first = new LazyJsxImportScope();
    const second = new LazyJsxImportScope();
    const initialSize = bridgeSize();
    try {
      await writeTextFile(artifact, source);
      // A preceding HTTP literal changes masked offsets. The rewriter must use
      // lexer offsets only against the masked source and preserve that literal.
      const code = `export const url = "https://example.com/a/long/path";
export const load = () => import(${JSON.stringify(`file://${artifact}`)});`;
      const [one, two] = await Promise.all([
        first.rewrite(code, dir),
        second.rewrite(code, dir),
      ]);
      assertEquals(one, two);
      assertEquals(bridgeSize(), initialSize + 1);
      first.release();
      assertEquals(bridgeSize(), initialSize + 1);
      const parent = join(dir, "parent.mjs");
      await writeTextFile(parent, two);
      const module = await import(`file://${parent}`);
      second.release();
      assertEquals(bridgeSize(), initialSize);
      await remove(artifact);
      const results = await Promise.all([module.load(), module.load()]);
      assertEquals(results[0], results[1]);
      assertEquals(results[0].value, 7);
      assertEquals(module.url, "https://example.com/a/long/path");
    } finally {
      first.release();
      second.release();
      await remove(dir, { recursive: true });
    }
  });

  it("releases artifact pins when evaluation rejects", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-reject-" });
    const source = 'throw new Error("fixture evaluation failed");';
    const artifact = join(dir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const scope = new LazyJsxImportScope();
    try {
      await writeTextFile(artifact, source);
      const parent = join(dir, "parent.mjs");
      await writeTextFile(
        parent,
        await scope.rewrite(
          `export const load = () => import(${JSON.stringify(`file://${artifact}`)});`,
          dir,
        ),
      );
      const module = await import(`file://${parent}`);
      scope.release();
      await remove(artifact);
      await assertRejects(() => module.load(), Error, "fixture evaluation failed");
      assertEquals(__jsxCacheInternals.isLazyArtifactRetained(artifact), false);
    } finally {
      scope.release();
      await remove(dir, { recursive: true });
    }
  });

  it("evaluates awaited and yielded import options in their original scope", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-options-" });
    const source = "export const value = 9;";
    const artifact = join(dir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const scope = new LazyJsxImportScope();
    try {
      await writeTextFile(artifact, source);
      const specifier = JSON.stringify(`file://${artifact}`);
      const code = `export const load = async () => import(${specifier}, await Promise.resolve({}));
export function* generate() { return import(${specifier}, yield "options"); }`;
      const parent = join(dir, "parent.mjs");
      await writeTextFile(parent, await scope.rewrite(code, dir));
      const module = await import(`file://${parent}`);
      scope.release();
      await remove(artifact);
      assertEquals((await module.load()).value, 9);
      const iterator = module.generate();
      assertEquals(iterator.next().value, "options");
      assertEquals((await iterator.next({}).value).value, 9);
    } finally {
      scope.release();
      await remove(dir, { recursive: true });
    }
  });

  it("does not recover arbitrary file imports outside the JSX cache namespace", async () => {
    const scope = new LazyJsxImportScope();
    const code = 'export const load = () => import("file:///missing/module.mjs");';
    try {
      assertEquals(await scope.rewrite(code, "/cache"), code);
      await assertRejects(() => import("file:///missing/module.mjs"));
    } finally {
      scope.release();
    }
  });

  it("does not resolve bridge globals through authored bindings", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-bindings-" });
    const source = "export const value = 13;";
    const artifact = join(dir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const scope = new LazyJsxImportScope();
    try {
      await writeTextFile(artifact, source);
      const code = `export const Symbol = "authored symbol";
export const globalThis = "authored global";
export const load = () => import(${JSON.stringify(`file://${artifact}`)});`;
      const parent = join(dir, "parent.mjs");
      await writeTextFile(parent, await scope.rewrite(code, dir));
      const module = await import(`file://${parent}`);
      scope.release();
      await remove(artifact);
      assertEquals((await module.load()).value, 13);
      assertEquals(module.Symbol, "authored symbol");
      assertEquals(module.globalThis, "authored global");
    } finally {
      scope.release();
      await remove(dir, { recursive: true });
    }
  });

  it("bounds combined snapshots and leaves no registration after admission fails", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-payload-" });
    const source = "//" + "x".repeat(MAX_MDX_MODULE_CODE_BYTES / 2);
    const first = join(dir, buildMdxJsxCacheFileName("/project/One.tsx", source));
    const second = join(dir, buildMdxJsxCacheFileName("/project/Two.tsx", source));
    const scope = new LazyJsxImportScope();
    const initialSize = bridgeSize();
    try {
      await writeTextFile(first, source);
      await writeTextFile(second, source);
      const code = `export const one = () => import(${JSON.stringify(`file://${first}`)});
export const two = () => import(${JSON.stringify(`file://${second}`)});`;
      await assertRejects(() => scope.rewrite(code, dir), ModuleSourceLimitError);
      assertEquals(bridgeSize(), initialSize);
    } finally {
      scope.release();
      await remove(dir, { recursive: true });
    }
  });

  it("refreshes an existing artifact while its cross-process lease is held", async () => {
    const dir = await makeTempDir({ prefix: "vf-lazy-shared-" });
    const source = "export const value = 11;";
    const artifact = join(dir, buildMdxJsxCacheFileName("/project/Lazy.tsx", source));
    const scope = new LazyJsxImportScope();
    const fs = getLocalFs();
    const originalUtime = fs.utime?.bind(fs);
    let refreshedUnderLease = false;
    try {
      await writeTextFile(artifact, source);
      const parent = join(dir, "parent.mjs");
      await writeTextFile(
        parent,
        await scope.rewrite(
          `export const load = () => import(${JSON.stringify(`file://${artifact}`)});`,
          dir,
        ),
      );
      const module = await import(`file://${parent}`);
      scope.release();
      await originalUtime?.(artifact, new Date(0), new Date(0));
      fs.utime = async (path, atime, mtime) => {
        if (path === artifact) refreshedUnderLease = await fs.exists(`${artifact}.lock`);
        await originalUtime?.(path, atime, mtime);
      };
      assertEquals((await module.load()).value, 11);
      assertEquals(refreshedUnderLease, true);
    } finally {
      fs.utime = originalUtime;
      scope.release();
      await remove(dir, { recursive: true });
    }
  });
});
