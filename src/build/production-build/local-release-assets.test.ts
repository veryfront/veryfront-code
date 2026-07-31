import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
} from "#veryfront/release-assets/constants.ts";
import { parseReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  buildCachedHttpDependencyAssets,
  type ReleaseAssetHttpDependencyVendor,
} from "#veryfront/release-assets/build-executor.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { generateLocalReleaseAssetManifest } from "./local-release-assets.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  getReactImportMap,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { toFileUrl } from "#veryfront/compat/path/index.ts";

function makeAdapter() {
  const adapter = createMockAdapter();
  const removed: string[] = [];
  const tempDir = "/tmp/vf-local-release-assets-test";
  adapter.fs.makeTempDir = () => {
    adapter.fs.directories.add(tempDir);
    return Promise.resolve(tempDir);
  };
  const remove = adapter.fs.remove.bind(adapter.fs);
  adapter.fs.remove = async (path, options) => {
    removed.push(path);
    await remove(path, options);
  };

  return {
    writes: adapter.fs.files,
    byteWrites: adapter.fs.byteFiles,
    removed,
    adapter,
    tempDir,
  };
}

function decodeAsset(
  byteWrites: Map<string, Uint8Array>,
  path: string,
): string {
  const bytes = byteWrites.get(path);
  assertExists(bytes);
  return new TextDecoder().decode(bytes);
}

const fakeVendorHttpImports: ReleaseAssetHttpDependencyVendor = (code) => {
  const urls = [
    ...new Set(
      [...code.matchAll(/["'](https?:\/\/[^"']+)["']/g)]
        .map((match) => match[1])
        .filter((url): url is string => typeof url === "string"),
    ),
  ];

  return Promise.resolve({
    code,
    dependencies: urls.map((url) => ({
      specifier: url,
      manifestKey: url,
      code: `export const sourceUrl = ${JSON.stringify(url)};`,
    })),
  });
};

async function hasEsmShReactImport(code: string): Promise<boolean> {
  for (const imp of await parseImports(code)) {
    if (!imp.n) continue;
    try {
      const url = new URL(imp.n);
      if (url.hostname === "esm.sh" && url.pathname.startsWith("/react")) return true;
    } catch {
      // Not an absolute URL import.
    }
  }
  return false;
}

const fakeFrameworkTransform = () =>
  Promise.resolve(
    'import React from "react"; export const Head = () => React.createElement("title");',
  );

describe("build/production-build/local-release-assets", () => {
  const originalFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
  const originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag ?? "");
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalPinningFlag ?? "");
    clearReactVersionCache();
  });

  it("skips local dependency assets unless the dependency import-map flag is enabled", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "");
    const { adapter, byteWrites, writes } = makeAdapter();

    const manifest = await generateLocalReleaseAssetManifest({
      adapter,
      projectDir: "/project",
      outputDir: "/project/dist",
      dryRun: false,
      vendorHttpImports: fakeVendorHttpImports,
    });

    assertEquals(manifest, null);
    assertEquals(writes.size, 0);
    assertEquals(byteWrites.size, 0);
  });

  it("writes a local release asset manifest and React dependency assets when enabled", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites, writes, removed } = makeAdapter();

    const manifest = await generateLocalReleaseAssetManifest({
      adapter,
      projectDir: "/project",
      outputDir: "/project/dist",
      dryRun: false,
      projectId: "local-project",
      releaseId: "standalone-dev",
      vendorHttpImports: fakeVendorHttpImports,
      frameworkTransform: fakeFrameworkTransform,
    });

    assertExists(manifest);
    assertExists(manifest.dependencies.react);
    assertExists(manifest.dependencies["react-dom/client"]);
    assertEquals(manifest.modules, {});
    assertEquals(manifest.css, []);
    assertEquals(manifest.routes, {});

    const manifestText = writes.get("/project/dist/_veryfront/release-asset-manifest.json");
    assertExists(manifestText);
    const parsed = parseReleaseAssetManifest(JSON.parse(manifestText));
    assertExists(parsed);
    assertExists(parsed.dependencies.react);
    assertEquals(parsed.dependencies.react.contentHash, manifest.dependencies.react.contentHash);

    const reactAssetPath = `/project/dist/_vf/assets/${manifest.dependencies.react.contentHash}.js`;
    const reactAsset = decodeAsset(byteWrites, reactAssetPath);
    assertEquals(reactAsset.includes("sourceUrl"), true);
    assertExists(manifest.dependencies["veryfront/head"]);
    assertExists(manifest.dependencies["veryfront/react/head"]);

    const headAssetPath = `/project/dist/_vf/assets/${
      manifest.dependencies["veryfront/head"].contentHash
    }.js`;
    const headAsset = decodeAsset(byteWrites, headAssetPath);
    assertStringIncludes(
      headAsset,
      `/_vf/assets/${manifest.dependencies.react.contentHash}.js`,
    );
    assertEquals(await hasEsmShReactImport(headAsset), false);
    assertEquals(removed.includes("/tmp/vf-local-release-assets-test"), true);
  });

  it("uses config.react.version for local release dependency assets", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites } = makeAdapter();

    const manifest = await generateLocalReleaseAssetManifest({
      adapter,
      projectDir: "/project",
      outputDir: "/project/dist",
      dryRun: false,
      config: { react: { version: "18.3.1" } } as VeryfrontConfig,
      vendorHttpImports: fakeVendorHttpImports,
      frameworkTransform: fakeFrameworkTransform,
    });

    assertExists(manifest);
    const reactDependency = manifest.dependencies.react;
    assertExists(reactDependency);
    const reactAsset = decodeAsset(
      byteWrites,
      `/project/dist/_vf/assets/${reactDependency.contentHash}.js`,
    );
    assertStringIncludes(reactAsset, "react@18.3.1");
  });

  it("derives a validated source identity independent of the checkout path", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const first = makeAdapter();
    const second = makeAdapter();
    const common = {
      outputDir: "/output",
      dryRun: true,
      config: { react: { version: "18.3.1" } } as VeryfrontConfig,
      vendorHttpImports: fakeVendorHttpImports,
      frameworkTransform: fakeFrameworkTransform,
    };

    const firstManifest = await generateLocalReleaseAssetManifest({
      ...common,
      adapter: first.adapter,
      projectDir: "/checkout/one",
    });
    const secondManifest = await generateLocalReleaseAssetManifest({
      ...common,
      adapter: second.adapter,
      projectDir: "/different/checkout/two",
    });

    assertExists(firstManifest);
    assertExists(secondManifest);
    assertEquals(firstManifest.sourceContentHash, secondManifest.sourceContentHash);
    assertEquals(Object.isFrozen(firstManifest), true);
    assertEquals(first.writes.size + first.byteWrites.size, 0);
    assertEquals(second.writes.size + second.byteWrites.size, 0);
  });

  it("validates the assembled manifest before returning or writing it", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites, writes } = makeAdapter();

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter,
          projectDir: "/project",
          outputDir: "/project/dist",
          dryRun: false,
          projectId: "",
          config: { react: { version: "18.3.1" } } as VeryfrontConfig,
          vendorHttpImports: fakeVendorHttpImports,
          frameworkTransform: fakeFrameworkTransform,
        }),
      Error,
      "manifest failed internal validation",
    );

    assertEquals(writes.size + byteWrites.size, 0);
  });

  it("requires binary output support before creating build output", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites, writes } = makeAdapter();
    adapter.fs.writeFileBytes = undefined;

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter,
          projectDir: "/project",
          outputDir: "/project/dist",
          dryRun: false,
          config: { react: { version: "18.3.1" } } as VeryfrontConfig,
          vendorHttpImports: fakeVendorHttpImports,
          frameworkTransform: fakeFrameworkTransform,
        }),
      Error,
      "does not support binary release asset output",
    );

    assertEquals(writes.size + byteWrites.size, 0);
    assertEquals(adapter.fs.directories.has("/project/dist"), false);
  });

  it("preflights content-addressed outputs without overwriting existing bytes", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites, writes } = makeAdapter();
    const options = {
      adapter,
      projectDir: "/project",
      outputDir: "/project/dist",
      config: { react: { version: "18.3.1" } } as VeryfrontConfig,
      vendorHttpImports: fakeVendorHttpImports,
      frameworkTransform: fakeFrameworkTransform,
    };
    const planned = await generateLocalReleaseAssetManifest({
      ...options,
      dryRun: true,
    });
    assertExists(planned);
    const plannedReact = planned.dependencies.react;
    assertExists(plannedReact);
    const existingPath = `/project/dist/_vf/assets/${plannedReact.contentHash}.js`;
    byteWrites.set(existingPath, new Uint8Array([9]));

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          ...options,
          dryRun: false,
        }),
      Error,
      "Local release asset output already exists",
    );

    assertEquals([...(byteWrites.get(existingPath) ?? [])], [9]);
    assertEquals(writes.has("/project/dist/_veryfront/release-asset-manifest.json"), false);
  });

  it("treats dangling output symlinks as occupied destinations", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const root = await Deno.makeTempDir({ prefix: "vf-local-release-output-link-" });
    const outputDir = `${root}/dist`;
    const options = {
      adapter: denoAdapter,
      projectDir: `${root}/project`,
      outputDir,
      config: { react: { version: "18.3.1" } } as VeryfrontConfig,
      vendorHttpImports: fakeVendorHttpImports,
      frameworkTransform: fakeFrameworkTransform,
    };

    try {
      const planned = await generateLocalReleaseAssetManifest({
        ...options,
        dryRun: true,
      });
      assertExists(planned);
      const react = planned.dependencies.react;
      assertExists(react);
      const assetPath = `${outputDir}/_vf/assets/${react.contentHash}.js`;
      await Deno.mkdir(`${outputDir}/_vf/assets`, { recursive: true });
      await Deno.mkdir(`${outputDir}/_veryfront`);
      await Deno.symlink(`${root}/missing-target`, assetPath);

      await assertRejects(
        () =>
          generateLocalReleaseAssetManifest({
            ...options,
            dryRun: false,
          }),
        Error,
        "output already exists",
      );
      assertEquals((await Deno.lstat(assetPath)).isSymlink, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rolls back every attempted output after a binary write fails", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites, writes } = makeAdapter();
    const writeFileBytes = adapter.fs.writeFileBytes!.bind(adapter.fs);
    let writeCount = 0;
    adapter.fs.writeFileBytes = async (path, bytes) => {
      writeCount++;
      if (writeCount === 2) throw new Error("simulated asset storage failure");
      await writeFileBytes(path, bytes);
    };

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter,
          projectDir: "/project",
          outputDir: "/project/dist",
          dryRun: false,
          config: { react: { version: "18.3.1" } } as VeryfrontConfig,
          vendorHttpImports: fakeVendorHttpImports,
          frameworkTransform: fakeFrameworkTransform,
        }),
      Error,
      "simulated asset storage failure",
    );

    assertEquals(
      [...byteWrites.keys()].some((path) => path.startsWith("/project/dist/")),
      false,
    );
    assertEquals(writes.has("/project/dist/_veryfront/release-asset-manifest.json"), false);
    assertEquals(adapter.fs.directories.has("/project/dist"), false);
  });

  it("passes the project dependency snapshot to every local framework transform", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
    const { adapter } = makeAdapter();
    adapter.fs.files.set(
      "/project/package.json",
      JSON.stringify({ dependencies: { react: "18.3.1", lodash: "4.17.21" } }),
    );
    const pinningSource = createDependencyPinningSource({
      projectDir: "/project",
      adapter,
      isLocalProject: false,
      contentSourceId: "production-build",
    });
    const resolved = await resolveDependencyPinningSnapshot(pinningSource);
    const snapshot: DependencyPinningSnapshot = {
      cacheKey: resolved.cacheKey,
      dependencies: { ...resolved.dependencies },
    };
    const observed: Array<{
      snapshot: DependencyPinningSnapshot | undefined;
      source: unknown;
      reactVersion: string | undefined;
    }> = [];

    const manifest = await generateLocalReleaseAssetManifest({
      // deno-lint-ignore no-explicit-any
      adapter: adapter as any,
      projectDir: "/project",
      outputDir: "/project/dist",
      dryRun: true,
      vendorHttpImports: fakeVendorHttpImports,
      dependencyPinningSnapshot: snapshot,
      dependencyPinningSource: pinningSource,
      frameworkTransform: (
        _source,
        _sourceFile,
        _projectDir,
        _adapter,
        options,
      ) => {
        observed.push({
          snapshot: options.dependencyPinningSnapshot,
          source: options.dependencyPinningSource,
          reactVersion: options.reactVersion,
        });
        return Promise.resolve("export const framework = true;");
      },
    });

    assertExists(manifest);
    assertEquals(observed.length > 0, true);
    assertEquals(
      observed.every(
        (value) =>
          value.snapshot !== snapshot &&
          Object.isFrozen(value.snapshot) &&
          Object.isFrozen(value.snapshot?.dependencies) &&
          value.snapshot?.cacheKey === snapshot.cacheKey &&
          value.snapshot?.dependencies?.lodash === "4.17.21" &&
          value.source === pinningSource &&
          value.reactVersion === "18.3.1",
      ),
      true,
    );
  });

  it("canonicalizes and freezes a supplied dependency snapshot before any async gap", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
    const { adapter } = makeAdapter();
    adapter.fs.files.set(
      "/project/package.json",
      JSON.stringify({ dependencies: { react: "18.3.1", lodash: "4.17.21" } }),
    );
    const pinningSource = createDependencyPinningSource({
      projectDir: "/project",
      adapter,
      isLocalProject: false,
      contentSourceId: "production-build-mutable-snapshot",
    });
    const resolved = await resolveDependencyPinningSnapshot(pinningSource);
    const mutableDependencies = { ...resolved.dependencies };
    const suppliedSnapshot: DependencyPinningSnapshot = {
      cacheKey: resolved.cacheKey,
      dependencies: mutableDependencies,
    };
    const observed: DependencyPinningSnapshot[] = [];

    const manifestPromise = generateLocalReleaseAssetManifest({
      adapter,
      projectDir: "/project",
      outputDir: "/project/dist",
      dryRun: true,
      vendorHttpImports: fakeVendorHttpImports,
      frameworkTransform: (
        _source,
        _sourceFile,
        _projectDir,
        _adapter,
        options,
      ) => {
        assertExists(options.dependencyPinningSnapshot);
        observed.push(options.dependencyPinningSnapshot);
        return Promise.resolve("export const framework = true;");
      },
      dependencyPinningSnapshot: suppliedSnapshot,
      dependencyPinningSource: pinningSource,
    });
    mutableDependencies.react = "19.2.4";

    const manifest = await manifestPromise;

    assertExists(manifest);
    assertEquals(observed.length > 0, true);
    assertEquals(
      observed.every((snapshot) =>
        snapshot !== suppliedSnapshot &&
        Object.isFrozen(snapshot) &&
        Object.isFrozen(snapshot.dependencies) &&
        snapshot.dependencies?.react === "18.3.1"
      ),
      true,
    );
  });

  it("rejects a caller React version that disagrees with the dependency snapshot", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
    const { adapter } = makeAdapter();
    adapter.fs.files.set(
      "/project/package.json",
      JSON.stringify({ dependencies: { react: "18.3.1" } }),
    );
    const pinningSource = createDependencyPinningSource({
      projectDir: "/project",
      adapter,
      isLocalProject: false,
      contentSourceId: "production-build-react-mismatch",
    });
    const snapshot = await resolveDependencyPinningSnapshot(pinningSource);

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter,
          projectDir: "/project",
          outputDir: "/project/dist",
          dryRun: true,
          vendorHttpImports: fakeVendorHttpImports,
          frameworkTransform: fakeFrameworkTransform,
          dependencyPinningSnapshot: snapshot,
          dependencyPinningSource: pinningSource,
          reactVersion: "19.2.4",
        }),
      Error,
      "does not match dependency snapshot",
    );
  });

  it("includes existing cached HTTP dependency assets in the local manifest", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-local-release-assets-project-" });
    const outputDir = `${projectDir}/dist`;
    const sourceUrl = "https://esm.sh/next-themes?external=react,react-dom&target=es2022";

    try {
      await Deno.mkdir(`${projectDir}/.cache/veryfront-http-bundle`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/.cache/veryfront-http-bundle/http-123abc.mjs`,
        `/*! @vf-source: ${sourceUrl} */\nexport const ThemeProvider = () => null;\n`,
      );

      const manifest = await generateLocalReleaseAssetManifest({
        adapter: denoAdapter,
        projectDir,
        outputDir,
        dryRun: false,
        projectId: "local-project",
        releaseId: "standalone-dev",
        vendorHttpImports: fakeVendorHttpImports,
        frameworkTransform: fakeFrameworkTransform,
      });

      assertExists(manifest);
      const dependency = manifest.dependencies[sourceUrl];
      assertExists(dependency);
      const asset = await Deno.readTextFile(`${outputDir}/_vf/assets/${dependency.contentHash}.js`);
      assertEquals(asset.includes("ThemeProvider"), true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects file and symbolic-link cache roots", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-local-release-cache-root-" });
    const filePath = `${root}/cache-file`;
    const targetDir = `${root}/cache-target`;
    const linkedDir = `${root}/cache-link`;

    try {
      await Deno.writeTextFile(filePath, "not a directory");
      await Deno.mkdir(targetDir);
      await Deno.symlink(targetDir, linkedDir, { type: "dir" });

      await assertRejects(
        () => buildCachedHttpDependencyAssets({ cacheDir: filePath }),
        Error,
        "not a safe directory",
      );
      await assertRejects(
        () => buildCachedHttpDependencyAssets({ cacheDir: linkedDir }),
        Error,
        "not a safe directory",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects symbolic links inside the cached dependency tree", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-local-release-cache-tree-" });
    const cacheDir = `${root}/cache`;
    const externalDir = `${root}/external`;

    try {
      await Deno.mkdir(cacheDir);
      await Deno.mkdir(externalDir);
      await Deno.writeTextFile(
        `${externalDir}/http-linked.mjs`,
        "/*! @vf-source: https://cdn.example/linked.js */\nexport default 1;\n",
      );
      await Deno.symlink(externalDir, `${cacheDir}/linked`, { type: "dir" });

      await assertRejects(
        () => buildCachedHttpDependencyAssets({ cacheDir }),
        Error,
        "contains a symbolic link",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("requires cached dependencies to carry valid HTTP provenance", async () => {
    const cacheDir = await Deno.makeTempDir({ prefix: "vf-local-release-cache-source-" });

    try {
      await Deno.writeTextFile(
        `${cacheDir}/http-unmarked.mjs`,
        "export const localOnly = true;\n",
      );
      await assertRejects(
        () => buildCachedHttpDependencyAssets({ cacheDir }),
        Error,
        "missing a valid HTTP source marker",
      );
    } finally {
      await Deno.remove(cacheDir, { recursive: true });
    }
  });

  it("rewrites canonical file URLs when cache paths contain URL-significant characters", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-local-release-cache-url-" });
    const cacheDir = `${root}/bundle # cache`;
    const childPath = `${cacheDir}/http-child.mjs`;
    const parentPath = `${cacheDir}/http-parent.mjs`;
    const childSource = "https://cdn.example/child.js";
    const parentSource = "https://cdn.example/parent.js";

    try {
      await Deno.mkdir(cacheDir);
      await Deno.writeTextFile(
        childPath,
        `/*! @vf-source: ${childSource} */\nexport default 1;\n`,
      );
      await Deno.writeTextFile(
        parentPath,
        `/*! @vf-source: ${parentSource} */\n` +
          `import child from ${JSON.stringify(toFileUrl(childPath).href)};\n` +
          "export default child;\n",
      );

      const built = await buildCachedHttpDependencyAssets({ cacheDir });
      const parent = built.dependencies[parentSource];
      assertExists(parent);
      const parentAsset = built.assets.find((asset) => asset.contentHash === parent.contentHash);
      assertExists(parentAsset);
      const code = new TextDecoder().decode(parentAsset.bytes);
      assertStringIncludes(code, "/_vf/assets/");
      assertEquals(code.includes("file:"), false);
      assertEquals(code.includes(root), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects cached dependency bytes that are not valid UTF-8", async () => {
    const cacheDir = await Deno.makeTempDir({ prefix: "vf-local-release-cache-utf8-" });

    try {
      await Deno.writeFile(
        `${cacheDir}/http-invalid.mjs`,
        new Uint8Array([0xff, 0xfe, 0xfd]),
      );
      await assertRejects(
        () => buildCachedHttpDependencyAssets({ cacheDir }),
        Error,
        "not valid UTF-8",
      );
    } finally {
      await Deno.remove(cacheDir, { recursive: true });
    }
  });

  it("rejects conflicting dependency claims instead of applying source-order precedence", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-local-release-conflict-" });
    const reactUrl = getReactImportMap("18.3.1").react;
    const { adapter } = makeAdapter();

    try {
      await Deno.mkdir(`${projectDir}/.cache/veryfront-http-bundle`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/.cache/veryfront-http-bundle/http-conflict.mjs`,
        `/*! @vf-source: ${reactUrl} */\nexport const stale = true;\n`,
      );

      await assertRejects(
        () =>
          generateLocalReleaseAssetManifest({
            adapter,
            projectDir,
            outputDir: "/output",
            dryRun: true,
            config: { react: { version: "18.3.1" } } as VeryfrontConfig,
            vendorHttpImports: fakeVendorHttpImports,
            frameworkTransform: fakeFrameworkTransform,
          }),
        Error,
        "Conflicting release dependency",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("bounds concurrent asset writes", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-local-release-concurrency-" });
    const { adapter } = makeAdapter();
    const writeFileBytes = adapter.fs.writeFileBytes!.bind(adapter.fs);
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    adapter.fs.writeFileBytes = async (path, bytes) => {
      activeWrites++;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      try {
        await Promise.resolve();
        await writeFileBytes(path, bytes);
      } finally {
        activeWrites--;
      }
    };

    try {
      const cacheDir = `${projectDir}/.cache/veryfront-http-bundle`;
      await Deno.mkdir(cacheDir, { recursive: true });
      for (let index = 0; index < 24; index++) {
        const sourceUrl = `https://cdn.example/dependency-${index}.js`;
        await Deno.writeTextFile(
          `${cacheDir}/http-${index}abc.mjs`,
          `/*! @vf-source: ${sourceUrl} */\nexport const value = ${index};\n`,
        );
      }

      await generateLocalReleaseAssetManifest({
        adapter,
        projectDir,
        outputDir: "/output",
        dryRun: false,
        config: { react: { version: "18.3.1" } } as VeryfrontConfig,
        vendorHttpImports: fakeVendorHttpImports,
        frameworkTransform: fakeFrameworkTransform,
      });

      assertEquals(maximumActiveWrites > 1, true);
      assertEquals(maximumActiveWrites <= RELEASE_ASSET_UPLOAD_CONCURRENCY, true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("fails the build when local React dependency assets cannot be vendored", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, removed } = makeAdapter();

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter,
          projectDir: "/project",
          outputDir: "/project/dist",
          dryRun: false,
          vendorHttpImports: () => {
            throw new Error("esm.sh unavailable");
          },
        }),
      Error,
      "Failed to generate local release dependency assets",
    );

    assertEquals(removed.includes("/tmp/vf-local-release-assets-test"), true);
  });

  it("fails before writing when any local dependency coverage is incomplete", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, byteWrites, removed, writes } = makeAdapter();
    const oversizedFrameworkModule = "x".repeat(RELEASE_ASSET_MAX_SIZE_BYTES + 1);

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter,
          projectDir: "/project",
          outputDir: "/project/dist",
          dryRun: false,
          config: { react: { version: "18.3.1" } } as VeryfrontConfig,
          vendorHttpImports: fakeVendorHttpImports,
          frameworkTransform: () => Promise.resolve(oversizedFrameworkModule),
        }),
      Error,
      "Local release dependency coverage is incomplete",
    );

    assertEquals(writes.size, 0);
    assertEquals(byteWrites.size, 0);
    assertEquals(removed.includes("/tmp/vf-local-release-assets-test"), true);
  });

  it("reports cleanup failures and preserves both failures when generation also fails", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const successful = makeAdapter();
    successful.adapter.fs.remove = () => Promise.reject(new Error("cleanup denied"));

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          adapter: successful.adapter,
          projectDir: "/project",
          outputDir: "/output",
          dryRun: false,
          config: { react: { version: "18.3.1" } } as VeryfrontConfig,
          vendorHttpImports: fakeVendorHttpImports,
          frameworkTransform: fakeFrameworkTransform,
        }),
      Error,
      "Failed to clean up",
    );
    assertEquals(successful.writes.size, 0);
    assertEquals(successful.byteWrites.size, 0);

    const failed = makeAdapter();
    failed.adapter.fs.remove = () => Promise.reject(new Error("cleanup also denied"));
    let received: unknown;
    try {
      await generateLocalReleaseAssetManifest({
        adapter: failed.adapter,
        projectDir: "/project",
        outputDir: "/output",
        dryRun: true,
        config: { react: { version: "18.3.1" } } as VeryfrontConfig,
        vendorHttpImports: () => {
          throw new Error("vendoring failed");
        },
        frameworkTransform: fakeFrameworkTransform,
      });
    } catch (error) {
      received = error;
    }

    assertInstanceOf(received, AggregateError);
    assertEquals(received.errors.length, 2);
    assertStringIncludes(received.errors[0].message, "vendoring failed");
    assertStringIncludes(received.errors[1].message, "temporary directory");
  });
});
