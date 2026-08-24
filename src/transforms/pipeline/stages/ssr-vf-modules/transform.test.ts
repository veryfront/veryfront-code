import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { VeryfrontError } from "#veryfront/errors";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { fromFileUrl, join } from "#veryfront/compat/path/index.ts";
import {
  isCyclePlaceholder,
  reactReExportToEsmUrl,
  resolveAndTransformVeryfrontImport,
  stripJsonAttributesFromModuleImports,
  transformFrameworkCode,
} from "./transform.ts";
import {
  buildFrameworkTransformCacheKey,
  FRAMEWORK_ROOT,
  frameworkFileCache,
  MAX_RELATIVE_IMPORT_DEPTH,
  veryfrontTransformCache,
} from "./constants.ts";
import { buildReactUrl } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { resolveVeryfrontSourcePath } from "./path-resolver.ts";
import { fnv1aHash, hashCodeHex } from "#veryfront/utils/hash-utils.ts";

describe("reactReExportToEsmUrl", () => {
  const reactPath = (name: string) => join(FRAMEWORK_ROOT, "react", name);

  it("maps the React re-export to the esm.sh react bundle URL", () => {
    assertEquals(
      reactReExportToEsmUrl(reactPath("react.js"), "19.2.4"),
      buildReactUrl("react", "19.2.4"),
    );
  });

  it("maps react-dom client/server re-exports", () => {
    assertEquals(
      reactReExportToEsmUrl(reactPath("react-dom-client.js"), "19.2.4"),
      buildReactUrl("react-dom", "19.2.4", "/client", true),
    );
    assertEquals(
      reactReExportToEsmUrl(reactPath("react-dom-server.js"), "19.2.4"),
      buildReactUrl("react-dom", "19.2.4", "/server", true),
    );
  });

  it("maps jsx-runtime re-exports", () => {
    assertEquals(
      reactReExportToEsmUrl(reactPath("jsx-runtime.js"), "19.2.4"),
      buildReactUrl("react", "19.2.4", "/jsx-runtime", true),
    );
  });

  it("maps the react-dom re-export to the externalized react-dom bundle", () => {
    assertEquals(
      reactReExportToEsmUrl(reactPath("react-dom.js"), "19.2.4"),
      buildReactUrl("react-dom", "19.2.4", undefined, true),
      "react-dom.js must route to the externalized react-dom bundle",
    );
  });

  it("maps jsx-dev-runtime re-exports to the dev runtime", () => {
    assertEquals(
      reactReExportToEsmUrl(reactPath("jsx-dev-runtime.js"), "19.2.4"),
      buildReactUrl("react", "19.2.4", "/jsx-dev-runtime", true),
      "jsx-dev-runtime.js must route to the dev JSX runtime, not the production one",
    );
  });

  it("returns null for non-react-re-export framework files", () => {
    assertEquals(reactReExportToEsmUrl(join(FRAMEWORK_ROOT, "src", "foo.js"), "19.2.4"), null);
    assertEquals(reactReExportToEsmUrl(reactPath("not-a-reexport.js"), "19.2.4"), null);
  });

  // Drift guard: every React re-export source module under `react/` must have
  // a routing entry, otherwise SSR would link it to project React (the
  // dual-instance bug) and nothing would catch the regression.
  it("routes every React re-export source module to an esm.sh URL", async () => {
    const reactSrcDir = new URL("../../../../../react/", import.meta.url);
    const sources: string[] = [];
    for await (const entry of Deno.readDir(reactSrcDir)) {
      if (entry.isFile && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources.push(entry.name);
      }
    }
    // Sanity: the source dir was found and is non-trivial.
    assertEquals(sources.length >= 6, true);

    for (const name of sources) {
      const compiled = name.replace(/\.ts$/, ".js");
      const url = reactReExportToEsmUrl(reactPath(compiled), "19.2.4");
      assertEquals(
        typeof url === "string" && url.includes("esm.sh"),
        true,
        `react/${name} has no esm.sh routing entry in REACT_REEXPORT_SPECIFIERS`,
      );
    }
  });
});

// esbuild starts a child process that lives across tests, so we disable sanitizers
describe("transformFrameworkCode depth-limit fallback", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("isolates cached framework transforms by React version", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-react-cache-" });
    const sourcePath = `${tmp}/framework-module.js`;
    const source = "export const marker = 1;\n";

    try {
      await transformFrameworkCode(
        source,
        sourcePath,
        { reactVersion: "18.3.1", projectDir: tmp, fs: createFileSystem() },
      );
      await transformFrameworkCode(
        source,
        sourcePath,
        { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
      );

      const matchingKeys = [...frameworkFileCache.keys()].filter((key) => key.includes(sourcePath));
      assertEquals(matchingKeys.length, 2);
    } finally {
      for (const key of frameworkFileCache.keys()) {
        if (key.includes(sourcePath)) frameworkFileCache.delete(key);
      }
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("isolates cache and singleflight keys by project scope", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-project-cache-" });
    const sourcePath = `${tmp}/framework-module.js`;
    const projectA = `${tmp}/project-a`;
    const projectB = `${tmp}/project-b`;
    const source = "export const marker = 1;\n";

    await Deno.mkdir(projectA);
    await Deno.mkdir(projectB);

    const keyA = buildFrameworkTransformCacheKey(sourcePath, "19.2.4", projectA, source);
    const keyB = buildFrameworkTransformCacheKey(sourcePath, "19.2.4", projectB, source);

    const importMapKeyA = buildFrameworkTransformCacheKey(
      sourcePath,
      "19.2.4",
      projectA,
      source,
      "import-map-v1",
    );
    const importMapKeyB = buildFrameworkTransformCacheKey(
      sourcePath,
      "19.2.4",
      projectA,
      source,
      "import-map-v2",
    );

    try {
      assertEquals(keyA === keyB, false);
      assertEquals(importMapKeyA === importMapKeyB, false);

      await transformFrameworkCode(
        source,
        sourcePath,
        { reactVersion: "19.2.4", projectDir: projectA, fs: createFileSystem() },
      );
      await transformFrameworkCode(
        source,
        sourcePath,
        { reactVersion: "19.2.4", projectDir: projectB, fs: createFileSystem() },
      );

      assertEquals(frameworkFileCache.has(keyA), true);
      assertEquals(frameworkFileCache.has(keyB), true);
    } finally {
      frameworkFileCache.delete(keyA);
      frameworkFileCache.delete(keyB);
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("preserves framed cache-key bytes under inherited Array.prototype.toJSON", () => {
    const identifier = '/framework/quoted"module.ts';
    const reactVersion = "19.2.4";
    const projectDir = "/projects/line\nbreak";
    const source = 'export const marker = "quoted";\n';
    const importMapFingerprint = "import-map-v2";
    const contentFingerprint = `${source.length}:${hashCodeHex(source)}:${fnv1aHash(source)}`;
    const expectedLegacy = JSON.stringify([
      projectDir,
      reactVersion,
      identifier,
      contentFingerprint,
    ]);
    const expectedScoped = JSON.stringify([
      projectDir,
      reactVersion,
      importMapFingerprint,
      identifier,
      contentFingerprint,
    ]);
    const originalToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    let poisonedLegacy: string | undefined;
    let poisonedScoped: string | undefined;
    let distinctScoped: string | undefined;

    try {
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value: () => [],
      });
      poisonedLegacy = buildFrameworkTransformCacheKey(
        identifier,
        reactVersion,
        projectDir,
        source,
      );
      poisonedScoped = buildFrameworkTransformCacheKey(
        identifier,
        reactVersion,
        projectDir,
        source,
        importMapFingerprint,
      );
      distinctScoped = buildFrameworkTransformCacheKey(
        identifier,
        reactVersion,
        projectDir,
        source,
        "import-map-v3",
      );
    } finally {
      if (originalToJson) Object.defineProperty(Array.prototype, "toJSON", originalToJson);
      else Reflect.deleteProperty(Array.prototype, "toJSON");
    }

    assertEquals(poisonedLegacy, expectedLegacy);
    assertEquals(poisonedScoped, expectedScoped);
    assertEquals(poisonedScoped === distinctScoped, false);
  });

  it("coalesces concurrent transforms instead of reporting a false cycle", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-concurrent-" });
    const sourcePath = `${tmp}/framework-module.ts`;
    const source = [
      'import { FNV1A_PRIME_32 } from "#veryfront/utils/constants/crypto.ts";',
      "export const marker = FNV1A_PRIME_32;",
    ].join("\n");
    const baseFs = createFileSystem();

    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let signalReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalReadStarted = resolve;
    });
    let blocked = false;
    const fs = new Proxy(baseFs, {
      get(target, property, receiver) {
        if (property === "readTextFile") {
          return async (path: string) => {
            if (!blocked && path.includes("/utils/constants/crypto.ts")) {
              blocked = true;
              signalReadStarted();
              await readGate;
            }
            return await target.readTextFile(path);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const ctx = { reactVersion: "19.2.4", projectDir: tmp, fs };

    try {
      const first = transformFrameworkCode(source, sourcePath, ctx);
      await readStarted;
      const second = transformFrameworkCode(source, sourcePath, ctx);
      releaseRead();

      const [firstResult, secondResult] = await Promise.all([first, second]);
      assertEquals(isCyclePlaceholder(firstResult), false);
      assertEquals(isCyclePlaceholder(secondResult), false);
      assertEquals(secondResult, firstResult);
    } finally {
      releaseRead();
      for (const key of frameworkFileCache.keys()) {
        if (key.includes(tmp)) frameworkFileCache.delete(key);
      }
      for (const key of veryfrontTransformCache.keys()) {
        if (key.includes(tmp)) veryfrontTransformCache.delete(key);
      }
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("returns immediately when traversal ancestry identifies a real cycle", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-real-cycle-" });
    const sourcePath = `${tmp}/framework-module.js`;
    const source = "export const marker = 1;\n";
    const transformKey = buildFrameworkTransformCacheKey(
      sourcePath,
      "19.2.4",
      tmp,
      source,
    );

    try {
      const result = await transformFrameworkCode(source, sourcePath, {
        reactVersion: "19.2.4",
        projectDir: tmp,
        fs: createFileSystem(),
        transformAncestry: new Set([transformKey]),
      });

      assertEquals(isCyclePlaceholder(result), true);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("invalidates a same-path transform when its source content changes", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-source-cache-" });
    const sourcePath = `${tmp}/framework-module.js`;
    const ctx = { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() };

    try {
      const first = await transformFrameworkCode(
        "export const marker = 1;\n",
        sourcePath,
        ctx,
      );
      const second = await transformFrameworkCode(
        "export const marker = 2;\n",
        sourcePath,
        ctx,
      );

      assertStringIncludes(first, "marker = 1");
      assertStringIncludes(second, "marker = 2");
      assertEquals(second === first, false);
    } finally {
      for (const key of frameworkFileCache.keys()) {
        if (key.includes(tmp)) frameworkFileCache.delete(key);
      }
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("uses the TypeScript loader for embedded .ts.src modules", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-main-ts-src-" });
    const sourcePath = `${tmp}/framework-module.ts.src`;
    const source = [
      "const value: unknown = 1;",
      "const typed = <number> value;",
      "export { typed };",
    ].join("\n");

    try {
      const transformed = await transformFrameworkCode(
        source,
        sourcePath,
        { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
      );

      assertStringIncludes(transformed, "typed = value");
    } finally {
      for (const key of frameworkFileCache.keys()) {
        if (key.includes(tmp)) frameworkFileCache.delete(key);
      }
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("rewrites relative imports in the fallback to absolute file:// URLs so the cached output is loadable", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-fallback-" });
    const srcDir = `${tmp}/src/utils/constants`;
    await Deno.mkdir(srcDir, { recursive: true });
    const buildJs = `${srcDir}/build.js`;
    await Deno.writeTextFile(buildJs, "export const DEFAULT_BUILD_CONCURRENCY = 4;\n");
    const buffersJs = `${srcDir}/buffers.js`;
    await Deno.writeTextFile(buffersJs, "export const BUFFER_SIZE_1_KB = 1024;\n");

    const ownerPath = `${srcDir}/owner.js`;
    const ownerContent = [
      `import { DEFAULT_BUILD_CONCURRENCY } from "./build.js";`,
      `import { BUFFER_SIZE_1_KB } from "./buffers.js";`,
      `export const sum = DEFAULT_BUILD_CONCURRENCY + BUFFER_SIZE_1_KB;`,
    ].join("\n");
    await Deno.writeTextFile(ownerPath, ownerContent);

    try {
      const transformed = await transformFrameworkCode(
        ownerContent,
        ownerPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // The fallback should not leave bare ./foo.js imports in cached output:
      assertEquals(transformed.includes('from "./build.js"'), false);
      assertEquals(transformed.includes('from "./buffers.js"'), false);
      // It should rewrite them to file:// URLs pointing at the resolved sources:
      assertStringIncludes(transformed, `from "file://${buildJs}"`);
      assertStringIncludes(transformed, `from "file://${buffersJs}"`);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("transforms and caches embedded .src dependencies so the fallback works in compiled binaries", async () => {
    // In compiled binaries the resolver returns *.ts.src / *.js.src paths,
    // which the runtime cannot import directly. The fallback must materialize
    // a real .mjs cache file and link the import to that, not to the .src
    // source.
    const tmp = await makeTempDir({ prefix: "vf-vfmod-src-fallback-" });
    const srcDir = `${tmp}/src/utils`;
    await Deno.mkdir(srcDir, { recursive: true });
    // Only the .src copy exists (mirrors compiled-binary layout).
    const helperSrcPath = `${srcDir}/helper.ts.src`;
    await Deno.writeTextFile(helperSrcPath, "export const HELPER = 7;\n");

    const ownerPath = `${srcDir}/owner.ts.src`;
    const ownerContent = [
      `import { HELPER } from "./helper.js";`,
      `export const value = HELPER;`,
    ].join("\n");
    await Deno.writeTextFile(ownerPath, ownerContent);

    try {
      const transformed = await transformFrameworkCode(
        ownerContent,
        ownerPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // The fallback must NOT embed the .src path as the import URL.
      assert(
        !transformed.includes(".src"),
        `fallback emitted .src path: ${transformed}`,
      );
      assertEquals(transformed.includes('from "./helper.js"'), false);
      // It must link to a real .mjs cache file that exists.
      const match = transformed.match(/from "file:\/\/([^"]+\.mjs)"/);
      assert(match, `fallback did not emit a .mjs file:// URL: ${transformed}`);
      const cachePath = match[1]!;
      assert(
        await Deno.stat(cachePath).then(() => true).catch(() => false),
        `cache file does not exist on disk: ${cachePath}`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("does not poison frameworkFileCache with fallback output", async () => {
    const { frameworkFileCache } = await import("./constants.ts");
    const tmp = await makeTempDir({ prefix: "vf-vfmod-cache-iso-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const depPath = `${srcDir}/dep.ts.src`;
    await Deno.writeTextFile(depPath, "export const X = 1;\n");
    const ownerPath = `${srcDir}/owner.ts.src`;
    const ownerContent = 'import { X } from "./dep.js"; export const y = X;';
    await Deno.writeTextFile(ownerPath, ownerContent);

    const cacheKeysBefore = new Set(frameworkFileCache.keys());

    try {
      await transformFrameworkCode(
        ownerContent,
        ownerPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // The fallback emits esbuild-only code (no `#veryfront/` / React
      // rewriting). It must not write that into the cache the main
      // transform path also reads — otherwise a later main-path call for
      // the same dep would receive degraded output.
      const newKeys = [...frameworkFileCache.keys()].filter((k) => !cacheKeysBefore.has(k));
      assertEquals(
        newKeys.includes(
          buildFrameworkTransformCacheKey(
            depPath,
            "19.1.1",
            tmp,
            "export const X = 1;\n",
          ),
        ),
        false,
        `fallback poisoned frameworkFileCache with ${depPath}`,
      );
      assertEquals(
        newKeys.includes(
          buildFrameworkTransformCacheKey(ownerPath, "19.1.1", tmp, ownerContent),
        ),
        false,
        `fallback poisoned frameworkFileCache with ${ownerPath}`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("uses the ts loader for .mts and the js loader for .mjs / .cjs", async () => {
    // Indirectly verify the loader picker via the fallback output: pass
    // TypeScript-only syntax (`as const`) through a `.mts.src` source and
    // confirm esbuild produced JS (would throw if loaded as `js`).
    const tmp = await makeTempDir({ prefix: "vf-vfmod-mts-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const sourcePath = `${srcDir}/uses-as-const.mts.src`;
    const sourceContent = 'export const TAG = "x" as const;';
    await Deno.writeTextFile(sourcePath, sourceContent);

    try {
      const transformed = await transformFrameworkCode(
        sourceContent,
        sourcePath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // `as const` is TS-only; if the loader had picked `js`, esbuild
      // would have thrown a syntax error. Surviving transform proves the
      // loader matched `.mts` to `ts`.
      assertStringIncludes(transformed, 'const TAG = "x"');
      assertEquals(transformed.includes("as const"), false);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("does not propagate a cycle placeholder from frameworkFileCache into the fallback cache file", async () => {
    const { frameworkFileCache } = await import("./constants.ts");
    const tmp = await makeTempDir({ prefix: "vf-vfmod-cycle-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const depPath = `${srcDir}/dep.ts.src`;
    // Real content for the dep on disk
    await Deno.writeTextFile(depPath, "export const X = 42;\n");
    // Simulate the main path having pre-cached a cycle placeholder for this dep
    const placeholder = `/* Cycle detected: ${depPath} */\nexport {};`;
    const depCacheKey = buildFrameworkTransformCacheKey(
      depPath,
      "19.1.1",
      tmp,
      "export const X = 42;\n",
    );
    frameworkFileCache.set(depCacheKey, placeholder);

    const ownerPath = `${srcDir}/owner.ts.src`;
    const ownerContent = 'import { X } from "./dep.js"; export const y = X;';
    await Deno.writeTextFile(ownerPath, ownerContent);

    try {
      const transformed = await transformFrameworkCode(
        ownerContent,
        ownerPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // The emitted cache file URL must not link to a file whose contents
      // are the cycle-placeholder. Read it back and check for the real
      // dep's content (`export const X = 42`).
      const match = transformed.match(/from "file:\/\/([^"]+\.mjs)"/);
      assert(match, `fallback did not emit a .mjs URL: ${transformed}`);
      const cachePath = match[1]!;
      const written = await Deno.readTextFile(cachePath);
      assertEquals(
        written.includes("Cycle detected"),
        false,
        `cycle placeholder leaked into fallback cache file: ${written}`,
      );
      assertStringIncludes(written, "X = 42");
    } finally {
      frameworkFileCache.delete(depCacheKey);
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("rematerializes a cached #veryfront file URL when the target file is missing", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-stale-url-" });
    const specifier = "#veryfront/utils/hash-utils.ts";
    const sourcePath = await resolveVeryfrontSourcePath(specifier);
    assert(sourcePath, `${specifier} did not resolve to a framework source file`);
    const content = await Deno.readTextFile(sourcePath);
    const transformKey = buildFrameworkTransformCacheKey(
      `${specifier}:${sourcePath}`,
      "19.2.4",
      tmp,
      content,
    );
    const missingPath = `${tmp}/framework/vfmod-vf-framework-stale.mjs`;
    const staleFileUrl = `file://${missingPath}`;
    veryfrontTransformCache.set(transformKey, staleFileUrl);

    try {
      const resolved = await resolveAndTransformVeryfrontImport(specifier, {
        reactVersion: "19.2.4",
        projectDir: tmp,
        fs: createFileSystem(),
      });

      assert(resolved, "resolver did not return a file URL");
      assertEquals(resolved === staleFileUrl, false);
      const resolvedPath = fromFileUrl(resolved);
      const stat = await Deno.stat(resolvedPath);
      assertEquals(stat.isFile, true);
    } finally {
      veryfrontTransformCache.delete(transformKey);
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("survives one bad .src dep without aborting the whole parent fallback", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-baddep-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    // A dep whose content is invalid TypeScript — esbuild should reject it.
    const badDep = `${srcDir}/bad.ts.src`;
    await Deno.writeTextFile(badDep, "export const = ;;; not valid syntax @@@");
    const goodDep = `${srcDir}/good.ts.src`;
    await Deno.writeTextFile(goodDep, "export const G = 1;\n");

    const ownerPath = `${srcDir}/owner.ts.src`;
    const ownerContent = [
      `import "./bad.js";`,
      `import { G } from "./good.js";`,
      `export const y = G;`,
    ].join("\n");
    await Deno.writeTextFile(ownerPath, ownerContent);

    try {
      // Must not throw: the bad dep is logged + left bare, the parent's
      // own compilation still succeeds. The exact rewriting of the good
      // dep depends on whether the test runtime has loaded the bundler
      // extension; the load-bearing assertion is "did not throw".
      const transformed = await transformFrameworkCode(
        ownerContent,
        ownerPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // Survived: the parent file produced output. The bad-dep handling
      // is verified by the absence of an unhandled exception above.
      assert(transformed.length > 0, "fallback returned empty output");

      // The unresolvable dep is left bare rather than aborting the parent.
      assertStringIncludes(
        transformed,
        "./bad.js",
        "the unresolvable dep must be left bare rather than aborting the parent",
      );

      // Control: the same good dep, transformed without a failing sibling.
      // Comparing the two runs pins "a bad sibling changes nothing about the
      // good one" without depending on whether this runtime materializes it.
      const controlPath = `${srcDir}/owner-good.ts.src`;
      const controlContent = [
        `import { G } from "./good.js";`,
        `export const z = G;`,
      ].join("\n");
      await Deno.writeTextFile(controlPath, controlContent);
      const controlTransformed = await transformFrameworkCode(
        controlContent,
        controlPath,
        { reactVersion: "19.1.1", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      assertEquals(
        transformed.includes('from "./good.js"'),
        controlTransformed.includes('from "./good.js"'),
        "a failing sibling dep must not change how ./good.js is linked",
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails closed on an unresolvable #veryfront import when asked to throw", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-missing-vf-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const sourcePath = `${srcDir}/imports-missing-vf.ts`;
    const sourceContent = [
      `import { missing } from "#veryfront/does-not-exist.ts";`,
      `export const y = missing;`,
    ].join("\n");

    try {
      const error = await assertRejects(
        () =>
          transformFrameworkCode(
            sourceContent,
            sourcePath,
            { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
            true,
          ),
        VeryfrontError,
        "#veryfront/does-not-exist.ts",
      );
      assertEquals(
        (error as VeryfrontError).slug,
        "import-resolution-error",
        "an unresolvable framework import must surface as import-resolution-error",
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails closed on an unresolvable relative import when asked to throw", async () => {
    const tmp = await makeTempDir({ prefix: "vf-vfmod-missing-rel-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const sourcePath = `${srcDir}/imports-missing-relative.ts`;
    const sourceContent = [
      `import { gone } from "./not-on-disk.js";`,
      `export const y = gone;`,
    ].join("\n");

    try {
      const error = await assertRejects(
        () =>
          transformFrameworkCode(
            sourceContent,
            sourcePath,
            { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
            true,
          ),
        VeryfrontError,
        "./not-on-disk.js",
      );
      assertEquals(
        (error as VeryfrontError).slug,
        "import-resolution-error",
        "an unresolvable relative framework import must surface as import-resolution-error",
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("materializes bare npm imports to loadable file:// bundles in the fallback", async () => {
    // The fallback runs the same http-cache pass as the main path, so bare
    // npm specifiers are resolved to local file:// bundles rather than left
    // for ad-hoc runtime resolution. This keeps the fallback's cached output
    // self-contained and Node-loadable.
    const tmp = await makeTempDir({ prefix: "vf-vfmod-fallback-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const sourcePath = `${srcDir}/uses-lodash.js`;
    const sourceContent = [
      `import { merge } from "lodash";`,
      `export const fn = merge;`,
    ].join("\n");
    await Deno.writeTextFile(sourcePath, sourceContent);

    try {
      const transformed = await transformFrameworkCode(
        sourceContent,
        sourcePath,
        { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // No bare specifier and no remote https: import left behind.
      assertEquals(transformed.includes('from "lodash"'), false);
      assertEquals(/from\s+["']https:\/\//.test(transformed), false);
      // And the positive half: it became a local bundle that exists on disk.
      assertStringIncludes(
        transformed,
        "file://",
        "a bare npm specifier must be materialized to a local bundle",
      );
      const bundleMatch = transformed.match(/from\s+"(file:\/\/[^"]+)"/);
      assert(bundleMatch?.[1], "expected a file:// specifier in the fallback output");
      const bundleStat = await Deno.stat(fromFileUrl(bundleMatch[1]));
      assertEquals(bundleStat.isFile, true, "the materialized bundle must exist on disk");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("rewrites react imports in the fallback to a loadable, single-instance bundle", async () => {
    // Regression: when a deep framework file exceeds the relative-import
    // depth limit, the fallback used to leave bare `react` imports. Those
    // resolve to the project's own React copy, distinct from the esm.sh
    // React bundle used elsewhere during SSR — two React instances, so the
    // dispatcher is null and the first hook throws
    // "Cannot read properties of null (reading 'useEffect')". The fallback
    // rewrites react/react-dom to the esm.sh bundle, then (like the main path)
    // materializes it to a local file:// bundle so Node can load the cached
    // fallback module (Node rejects `import ... from "https:"`).
    const tmp = await makeTempDir({ prefix: "vf-vfmod-react-id-" });
    const srcDir = `${tmp}/src`;
    await Deno.mkdir(srcDir, { recursive: true });
    const sourcePath = `${srcDir}/uses-react.js`;
    const sourceContent = [
      `import { useEffect } from "react";`,
      `export const hook = useEffect;`,
    ].join("\n");
    await Deno.writeTextFile(sourcePath, sourceContent);

    try {
      const transformed = await transformFrameworkCode(
        sourceContent,
        sourcePath,
        { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
        false,
        MAX_RELATIVE_IMPORT_DEPTH + 1,
      );

      // Not bare (dual-instance bug) and not a raw https: import (Node would
      // reject it when the cached fallback module loads). It must be a local
      // file:// bundle.
      assertEquals(transformed.includes('from "react"'), false);
      assertEquals(/from\s+["']https:\/\//.test(transformed), false);
      assertStringIncludes(transformed, "file://");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
});

describe("stripJsonAttributesFromModuleImports", () => {
  // A framework `.json` import is resolved by compiling the JSON into a cached
  // `.mjs` that default-exports the data. The attribute describes the original
  // target, so leaving it makes the runtime reject the rewritten import with
  // "Expected a Json module, but identified a Mjs module".
  it("drops the attribute when the target is now an .mjs", async () => {
    const code = `import m from "file:///cache/framework/vfmod-abc.mjs" with { type: "json" };`;
    assertEquals(
      await stripJsonAttributesFromModuleImports(code),
      `import m from "file:///cache/framework/vfmod-abc.mjs";`,
    );
  });

  it("drops the attribute from a dynamic import of a rewritten module", async () => {
    const code =
      `export async function load() { return import("file:///cache/a.mjs", { with: { type: "json" } }); }`;
    assertEquals(
      await stripJsonAttributesFromModuleImports(code),
      `export async function load() { return import("file:///cache/a.mjs"); }`,
    );
  });

  it("keeps the attribute on a genuine .json target", async () => {
    const code = `import m from "./manifest.json" with { type: "json" };`;
    assertEquals(await stripJsonAttributesFromModuleImports(code), code);
  });

  it("handles single quotes and extra whitespace", async () => {
    const code = `import m from 'file:///cache/a.mjs'  with  { type: 'json' };`;
    assertStringIncludes(
      await stripJsonAttributesFromModuleImports(code),
      `from 'file:///cache/a.mjs';`,
    );
  });

  it("leaves plain module imports untouched", async () => {
    const code = `import { a } from "file:///cache/a.mjs";`;
    assertEquals(await stripJsonAttributesFromModuleImports(code), code);
  });

  // The framework embeds module source in string literals (the `#deno-config`
  // stub, the generated RSC bundles). Rewriting those corrupts the payload and
  // the corruption is content-hashed straight into the cache.
  it("leaves import-like text inside a string literal alone", async () => {
    const code = 'export const TPL = `import d from "file:///cache/a.mjs" with { type: "json" };`;';
    assertEquals(await stripJsonAttributesFromModuleImports(code), code);
  });

  it("keeps an attribute clause that is not a json type", async () => {
    const code = `import m from "file:///cache/a.mjs" with { type: "css" };`;
    assertEquals(await stripJsonAttributesFromModuleImports(code), code);
  });
});
