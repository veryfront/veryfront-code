import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getModulePathCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { buildMdxEsmPathCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { persistTransformedModule } from "./module-persistence.ts";

describe("module-loader/module-persistence", () => {
  it("writes transformed code, registers MDX path-cache, and updates module cache", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.tsx");
    const transformedCode = "export const page = 1;";
    const moduleCache = new Map<string, string>();
    const cacheKey = "project:preview:page";

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.writeTextFile(filePath, "export const page = 1;");

      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode,
        localAdapter,
        moduleCache,
        cacheKey,
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
      });

      const expectedHash = hashCodeHex(transformedCode).slice(0, 8);
      assertEquals(result, join(tmpDir, `app/page.${expectedHash}.js`));
      assertEquals(await Deno.readTextFile(result), transformedCode);
      assertEquals(moduleCache.get(cacheKey), result);

      const pathCache = await getModulePathCache(tmpDir);
      const mdxCacheKey = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
      assertEquals(pathCache.get(mdxCacheKey), result);
    } finally {
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("recreates the output directory when it disappears after being cached", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "lib/uses-crypto.ts");
    const moduleCache = new Map<string, string>();

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });

      const first = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const a = 1;",
        localAdapter,
        moduleCache,
        cacheKey: "first",
      });
      assertEquals(await Deno.readTextFile(first), "export const a = 1;");

      // Something outside the loader wipes the cache dir (manual `rm -rf .cache`,
      // a cache sweep, a container restart). The mkdir memo still claims it exists.
      await Deno.remove(join(tmpDir, "lib"), { recursive: true });

      const second = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const a = 2;",
        localAdapter,
        moduleCache,
        cacheKey: "second",
      });
      assertEquals(await Deno.readTextFile(second), "export const a = 2;");
    } finally {
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("does not cache a failed mkdir as a created directory", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "lib/transient.ts");
    const moduleCache = new Map<string, string>();

    // A transient mkdir failure (EMFILE under concurrent compilation) must not
    // poison the memo — otherwise every later write to that directory ENOENTs.
    let failNextMkdir = true;
    const stubFs = Object.create(localAdapter.fs) as typeof localAdapter.fs;
    stubFs.mkdir = (path: string, options?: { recursive?: boolean }) => {
      if (failNextMkdir) {
        failNextMkdir = false;
        return Promise.reject(new Error("EMFILE: too many open files, mkdir"));
      }
      return localAdapter.fs.mkdir(path, options);
    };
    const stubAdapter = Object.create(localAdapter) as typeof localAdapter;
    Object.defineProperty(stubAdapter, "fs", { value: stubFs });

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });

      await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const b = 1;",
        localAdapter: stubAdapter,
        moduleCache,
        cacheKey: "transient",
      }).catch(() => undefined);

      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const b = 2;",
        localAdapter: stubAdapter,
        moduleCache,
        cacheKey: "transient-retry",
      });
      assertEquals(await Deno.readTextFile(result), "export const b = 2;");
    } finally {
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("retries the mkdir on a later write when an earlier mkdir failed", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "lib/transient.ts");
    const moduleCache = new Map<string, string>();

    // mkdir always rejects, and the writes are made to land anyway by creating
    // the output directory out of band. This isolates the memo from the write
    // retry: the question is only whether a failed mkdir is remembered as done.
    let mkdirCalls = 0;
    const stubFs = Object.create(localAdapter.fs) as typeof localAdapter.fs;
    stubFs.mkdir = () => {
      mkdirCalls++;
      return Promise.reject(new Error("EMFILE: too many open files, mkdir"));
    };
    const stubAdapter = Object.create(localAdapter) as typeof localAdapter;
    Object.defineProperty(stubAdapter, "fs", { value: stubFs });

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.mkdir(join(tmpDir, "lib"), { recursive: true });

      const persist = (transformedCode: string, cacheKey: string) =>
        persistTransformedModule({
          filePath,
          projectDir,
          tmpDir,
          transformedCode,
          localAdapter: stubAdapter,
          moduleCache,
          cacheKey,
        });

      await persist("export const b = 1;", "one").catch(() => undefined);
      const before = mkdirCalls;
      await persist("export const b = 2;", "two").catch(() => undefined);

      // A failed mkdir must not be remembered as a created directory: the second
      // persist has to attempt the mkdir again rather than trust a poisoned memo.
      assertEquals(mkdirCalls > before, true);
    } finally {
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("rethrows a non-race write error without retrying the write", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "lib/denied.ts");
    const moduleCache = new Map<string, string>();

    // A permission error is not a vanished-directory race, so recreating the
    // directory and writing again would just fail twice on an already-degraded
    // filesystem. It must surface immediately.
    let writeCalls = 0;
    const stubFs = Object.create(localAdapter.fs) as typeof localAdapter.fs;
    stubFs.writeFile = () => {
      writeCalls++;
      return Promise.reject(new Error("EACCES: permission denied, open"));
    };
    const stubAdapter = Object.create(localAdapter) as typeof localAdapter;
    Object.defineProperty(stubAdapter, "fs", { value: stubFs });

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });

      let rejected = false;
      await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const c = 1;",
        localAdapter: stubAdapter,
        moduleCache,
        cacheKey: "denied",
      }).catch(() => {
        rejected = true;
      });

      assertEquals(rejected, true);
      assertEquals(writeCalls, 1);
    } finally {
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });
});
