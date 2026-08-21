import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { basename, dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getModulePathCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  buildMdxEsmPathCacheKey,
  MDX_MODULE_DEV_COMPILE_VARIANT,
  UNRESOLVED_IMPORTS_SIDECAR_SUFFIX,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import {
  drainModulePathCacheSaves,
  persistTransformedModule,
  readPersistedUnresolvedSpecifiers,
  setModulePathCacheSaveForTesting,
  transformedModuleHasDefaultExport,
} from "./module-persistence.ts";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("module-loader/module-persistence", () => {
  const beforeDrainCleanups: Array<() => void> = [];
  const afterDrainAssertions: Array<() => void> = [];
  const restoreSaveHooks: Array<() => void> = [];

  afterEach(async () => {
    for (const cleanup of beforeDrainCleanups.splice(0).reverse()) cleanup();
    await drainModulePathCacheSaves();
    for (const assertion of afterDrainAssertions.splice(0).reverse()) assertion();
    for (const restore of restoreSaveHooks.splice(0).reverse()) restore();
    await drainModulePathCacheSaves();
  });

  it("writes transformed code, registers MDX path-cache, and updates module cache", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.tsx");
    const transformedCode = "export const page = 1;";
    const moduleCache = new Map<string, string>();
    const cacheKey = "project:preview:page";

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeTextFile(filePath, "export const page = 1;");

      const unresolvedSpecifiers = ["./missing", "./nested-missing"];

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
        unresolvedSpecifiers,
      });

      const expectedHash = hashCodeHex(
        `${transformedCode}\0${JSON.stringify(unresolvedSpecifiers)}`,
      ).slice(0, 8);
      assertEquals(result, join(tmpDir, `app/page.${expectedHash}.js`));
      assertEquals(await readTextFile(result), transformedCode);
      assertEquals(moduleCache.get(cacheKey), result);
      assertEquals(
        await readPersistedUnresolvedSpecifiers(result, localAdapter),
        unresolvedSpecifiers,
      );

      const pathCache = await getModulePathCache(tmpDir);
      const mdxCacheKey = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
      assertEquals(pathCache.get(mdxCacheKey), result);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("defers memory and path-cache publication until the graph commits", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.ts");
    const moduleCache = new Map<string, string>();
    let publication: (() => Promise<void>) | undefined;

    try {
      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const page = 1;",
        localAdapter,
        moduleCache,
        cacheKey: "deferred",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
        deferCachePublication: (publish) => {
          publication = publish;
        },
      });

      const pathCache = await getModulePathCache(tmpDir);
      const mdxCacheKey = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
      assertEquals(moduleCache.has("deferred"), false);
      assertEquals(pathCache.has(mdxCacheKey), false);

      await publication?.();

      assertEquals(moduleCache.get("deferred"), result);
      assertEquals(pathCache.get(mdxCacheKey), result);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("registers the artifact under the compile mode it was transformed with", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.ts");
    const moduleCache = new Map<string, string>();

    try {
      const developmentPath = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const compiledFor = 'development';",
        localAdapter,
        moduleCache,
        cacheKey: "development",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
        dev: true,
      });
      const productionPath = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const compiledFor = 'production';",
        localAdapter,
        moduleCache,
        cacheKey: "production",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
        dev: false,
      });

      // persistTransformedModule publishes the index write without awaiting it.
      await drainModulePathCacheSaves();
      assertEquals(
        await readTextFile(developmentPath),
        "export const compiledFor = 'development';",
      );
      assertEquals(
        await readTextFile(productionPath),
        "export const compiledFor = 'production';",
      );

      const pathCache = await getModulePathCache(tmpDir);
      const developmentKey = buildMdxEsmPathCacheKey(
        "_vf_modules/app/page.js",
        "19.1.1",
        MDX_MODULE_DEV_COMPILE_VARIANT,
      );
      const productionKey = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

      // A production reader resolves the production key, so the two artifacts
      // must sit under separate entries rather than overwriting each other.
      assertNotEquals(developmentKey, productionKey);
      assertEquals(pathCache.get(developmentKey), developmentPath);
      assertEquals(pathCache.get(productionKey), productionPath);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("keeps path-cache save off the critical path and drains a successful save", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/nonblocking.ts");
    const moduleCache = new Map<string, string>();
    const saveStarted = deferred();
    const releaseSave = deferred();
    let saveCompleted = false;

    restoreSaveHooks.push(setModulePathCacheSaveForTesting(async (cacheDir) => {
      assertEquals(cacheDir, tmpDir);
      saveStarted.resolve();
      await releaseSave.promise;
      saveCompleted = true;
    }));

    try {
      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const nonblocking = true;",
        localAdapter,
        moduleCache,
        cacheKey: "nonblocking",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
      });

      await saveStarted.promise;
      assertEquals(saveCompleted, false);
      assertEquals(moduleCache.get("nonblocking"), result);

      let drained = false;
      const drain = drainModulePathCacheSaves().then(() => {
        drained = true;
      });
      await Promise.resolve();
      assertEquals(drained, false);

      releaseSave.resolve();
      await drain;
      assertEquals(saveCompleted, true);
      assertEquals(drained, true);
    } finally {
      releaseSave.resolve();
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("drains failed path-cache saves without surfacing an unhandled rejection", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/failing-save.ts");
    const moduleCache = new Map<string, string>();
    let saveCalls = 0;

    restoreSaveHooks.push(setModulePathCacheSaveForTesting(() => {
      saveCalls++;
      return Promise.reject(new Error("synthetic save failure"));
    }));

    try {
      await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const failing = true;",
        localAdapter,
        moduleCache,
        cacheKey: "failing-save",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
      });

      await drainModulePathCacheSaves();
      await drainModulePathCacheSaves();
      assertEquals(saveCalls, 1);
      assertEquals(moduleCache.has("failing-save"), true);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("drains multiple concurrent path-cache saves", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const moduleCache = new Map<string, string>();
    const releases = [deferred(), deferred(), deferred()] as const;
    let saveCalls = 0;

    restoreSaveHooks.push(setModulePathCacheSaveForTesting(async () => {
      const release = releases[saveCalls++ as 0 | 1 | 2];
      assert(release, "unexpected save call");
      await release.promise;
    }));

    try {
      const persists = [0, 1, 2].map((index) =>
        persistTransformedModule({
          filePath: join(projectDir, `app/concurrent-${index}.ts`),
          projectDir,
          tmpDir,
          transformedCode: `export const concurrent = ${index};`,
          localAdapter,
          moduleCache,
          cacheKey: `concurrent-${index}`,
          contentSourceId: "preview-main",
          reactVersion: "19.1.1",
        })
      );
      await Promise.all(persists);
      await Promise.resolve();
      assertEquals(saveCalls, 3);

      let drained = false;
      const drain = drainModulePathCacheSaves().then(() => {
        drained = true;
      });
      await Promise.resolve();
      assertEquals(drained, false);

      releases[0].resolve();
      await Promise.resolve();
      assertEquals(drained, false);
      releases[1].resolve();
      releases[2].resolve();
      await drain;
      assertEquals(drained, true);
    } finally {
      for (const release of releases) release.resolve();
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("drains a path-cache save started while an earlier save is draining", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const moduleCache = new Map<string, string>();
    const firstRelease = deferred();
    const secondStarted = deferred();
    const secondRelease = deferred();
    let saveCalls = 0;

    restoreSaveHooks.push(setModulePathCacheSaveForTesting(async () => {
      saveCalls++;
      if (saveCalls === 1) {
        await firstRelease.promise;
        await persistTransformedModule({
          filePath: join(projectDir, "app/second-during-drain.ts"),
          projectDir,
          tmpDir,
          transformedCode: "export const second = true;",
          localAdapter,
          moduleCache,
          cacheKey: "second-during-drain",
          contentSourceId: "preview-main",
          reactVersion: "19.1.1",
        });
        return;
      }
      secondStarted.resolve();
      await secondRelease.promise;
    }));

    try {
      await persistTransformedModule({
        filePath: join(projectDir, "app/first-during-drain.ts"),
        projectDir,
        tmpDir,
        transformedCode: "export const first = true;",
        localAdapter,
        moduleCache,
        cacheKey: "first-during-drain",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
      });

      let drained = false;
      const drain = drainModulePathCacheSaves().then(() => {
        drained = true;
      });
      await Promise.resolve();
      firstRelease.resolve();
      await secondStarted.promise;
      await Promise.resolve();
      assertEquals(drained, false);

      secondRelease.resolve();
      await drain;
      assertEquals(drained, true);
      assertEquals(saveCalls, 2);
    } finally {
      firstRelease.resolve();
      secondRelease.resolve();
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("lets teardown cleanup drain a pending path-cache save", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const releaseSave = deferred();
    let saveCompleted = false;
    let cleanupRan = false;

    restoreSaveHooks.push(setModulePathCacheSaveForTesting(async () => {
      await releaseSave.promise;
      saveCompleted = true;
    }));
    beforeDrainCleanups.push(() => {
      assertEquals(saveCompleted, false);
      releaseSave.resolve();
      cleanupRan = true;
    });
    afterDrainAssertions.push(() => {
      assertEquals(cleanupRan, true);
      assertEquals(saveCompleted, true);
    });

    try {
      await persistTransformedModule({
        filePath: join(projectDir, "app/teardown.ts"),
        projectDir,
        tmpDir,
        transformedCode: "export const teardown = true;",
        localAdapter,
        moduleCache: new Map<string, string>(),
        cacheKey: "teardown",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
      });
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("isolates artifacts across dependency snapshots", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.ts");
    const moduleCache = new Map<string, string>();

    try {
      const snapshotAPath = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: `export const snapshot = "A";`,
        localAdapter,
        moduleCache,
        cacheKey: "snapshot-a",
        dependencyPinningCacheKey: "on:34n9smy47dk9",
        moduleServerOrigin: "https://app.example.test",
      });
      const snapshotBPath = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: `export const snapshot = "B";`,
        localAdapter,
        moduleCache,
        cacheKey: "snapshot-b",
        dependencyPinningCacheKey: "on:34n8mjmdp7io",
        moduleServerOrigin: "https://app.example.test",
      });

      assertNotEquals(dirname(snapshotAPath), dirname(snapshotBPath));
      assertEquals(await readTextFile(snapshotAPath), `export const snapshot = "A";`);
      assertEquals(await readTextFile(snapshotBPath), `export const snapshot = "B";`);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("writes JavaScript at its authored path", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.js");
    const transformedCode = "export const page = 1;";
    try {
      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode,
        localAdapter,
        moduleCache: new Map<string, string>(),
        cacheKey: "javascript-module",
      });

      assertEquals(result, join(tmpDir, "app/page.js"));
      assertEquals(await readTextFile(result), transformedCode);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("keeps cycle artifacts outside the authored source namespace", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const cycleCode = `export const owner = "cycle";`;

    try {
      const cyclePath = await persistTransformedModule({
        filePath: join(projectDir, "lib/widget.js"),
        projectDir,
        tmpDir,
        transformedCode: cycleCode,
        localAdapter,
        moduleCache: new Map<string, string>(),
        cacheKey: "cycle-artifact",
        cycleArtifactPath: join(
          tmpDir,
          "_cycle-manifests/snapshot-a/artifacts/0.deadbeef.js",
        ),
      });
      const authoredPath = await persistTransformedModule({
        filePath: join(projectDir, "lib", basename(cyclePath)),
        projectDir,
        tmpDir,
        transformedCode: `export const owner = "authored";`,
        localAdapter,
        moduleCache: new Map<string, string>(),
        cacheKey: "authored-artifact",
      });

      assertNotEquals(authoredPath, cyclePath);
      assertEquals(await readTextFile(cyclePath), cycleCode);
      assertEquals(
        authoredPath,
        join(tmpDir, "lib", basename(cyclePath)),
      );
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("does not infer a default export from string contents", () => {
    assertEquals(
      transformedModuleHasDefaultExport(`export const label = "Set as default";`),
      false,
    );
  });

  it("does not infer a default export from regex contents", () => {
    const cases = [
      `export const pattern = /export default/;`,
      `if (enabled) /export default/.test(source); export const value = 1;`,
      `if (enabled) {} /export default/.test(source); export const value = 1;`,
      `function setup() {} /export default/.test(source); export const value = 1;`,
      `function setup({ nested: {} } = {}) {} /export default/.test(source); export const value = 1;`,
      `class Setup {} /export default/.test(source); export const value = 1;`,
      `class Setup extends mixin({}) {} /export default/.test(source); export const value = 1;`,
      `function read() { return /* keep the comment */ /export default/.source; }`,
      `function read() { return // keep the comment\n/export default/.source; }`,
    ] as const;

    for (const transformedCode of cases) {
      assertEquals(transformedModuleHasDefaultExport(transformedCode), false);
    }
  });

  it("detects whether transformed code exposes a default export", () => {
    const cases = [
      {
        transformedCode: `export default function Page() { return null; }`,
        exposesDefault: true,
      },
      {
        transformedCode: `const ratio = total / count; export default ratio;`,
        exposesDefault: true,
      },
      {
        transformedCode: `const ratio = mod.typeof / 2; export { default } from "./component.js";`,
        exposesDefault: true,
      },
      {
        transformedCode: `const Page = () => null;\nexport { Page as default };`,
        exposesDefault: true,
      },
      {
        transformedCode: `export { default as Page } from "./component.js";`,
        exposesDefault: false,
      },
    ] as const;

    for (const testCase of cases) {
      assertEquals(
        transformedModuleHasDefaultExport(testCase.transformedCode),
        testCase.exposesDefault,
      );
    }
  });

  it("recreates the output directory when it disappears after being cached", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "lib/uses-crypto.ts");
    const moduleCache = new Map<string, string>();

    try {
      await mkdir(dirname(filePath), { recursive: true });

      const first = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const a = 1;",
        localAdapter,
        moduleCache,
        cacheKey: "first",
      });
      assertEquals(await readTextFile(first), "export const a = 1;");

      // Something outside the loader wipes the cache dir (manual `rm -rf .cache`,
      // a cache sweep, a container restart). The mkdir memo still claims it exists.
      await remove(join(tmpDir, "lib"), { recursive: true });

      const second = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode: "export const a = 2;",
        localAdapter,
        moduleCache,
        cacheKey: "second",
      });
      assertEquals(await readTextFile(second), "export const a = 2;");
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("does not cache a failed mkdir as a created directory", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
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
      await mkdir(dirname(filePath), { recursive: true });

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
      assertEquals(await readTextFile(result), "export const b = 2;");
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("retries the mkdir on a later write when an earlier mkdir failed", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
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
      await mkdir(dirname(filePath), { recursive: true });
      await mkdir(join(tmpDir, "lib"), { recursive: true });

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
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("rethrows a non-race write error without retrying the write", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
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
      await mkdir(dirname(filePath), { recursive: true });

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
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("keeps the artifact available without caching when unresolved-import evidence cannot be written", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "lib/evidence.ts");
    const moduleCache = new Map<string, string>();
    const transformedCode = "export const evidence = true;";

    const stubFs = Object.create(localAdapter.fs) as typeof localAdapter.fs;
    stubFs.writeFile = (path: string, content: string) => {
      if (path.endsWith(UNRESOLVED_IMPORTS_SIDECAR_SUFFIX)) {
        return Promise.reject(new Error("ENOSPC: no space left on device"));
      }
      return localAdapter.fs.writeFile(path, content);
    };
    const stubAdapter = Object.create(localAdapter) as typeof localAdapter;
    Object.defineProperty(stubAdapter, "fs", { value: stubFs });

    try {
      await mkdir(dirname(filePath), { recursive: true });

      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode,
        localAdapter: stubAdapter,
        moduleCache,
        cacheKey: "evidence",
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
        unresolvedSpecifiers: ["./missing"],
      });

      assertEquals(await readTextFile(result), transformedCode);
      assertEquals(moduleCache.has("evidence"), false);
      assertEquals(await readPersistedUnresolvedSpecifiers(result, stubAdapter), []);

      const pathCache = await getModulePathCache(tmpDir);
      const mdxCacheKey = buildMdxEsmPathCacheKey("_vf_modules/lib/evidence.js", "19.1.1");
      assertEquals(pathCache.has(mdxCacheKey), false);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });
});
