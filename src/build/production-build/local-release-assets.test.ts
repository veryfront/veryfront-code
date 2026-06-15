import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { parseReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import type { ReleaseAssetHttpDependencyVendor } from "#veryfront/release-assets/build-executor.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { generateLocalReleaseAssetManifest } from "./local-release-assets.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";

function makeAdapter() {
  const writes = new Map<string, string>();
  const dirs: string[] = [];
  const removed: string[] = [];

  return {
    writes,
    dirs,
    removed,
    adapter: {
      id: "memory",
      name: "memory",
      capabilities: {},
      env: { get: () => undefined },
      server: {},
      serve: () => {
        throw new Error("not implemented");
      },
      fs: {
        readFile: (path: string) => Promise.resolve(writes.get(path) ?? ""),
        writeFile: (path: string, content: string) => {
          writes.set(path, content);
          return Promise.resolve();
        },
        exists: (path: string) => Promise.resolve(writes.has(path)),
        readDir: async function* () {},
        stat: () => Promise.resolve({ isFile: true, mtime: new Date() }),
        mkdir: (path: string) => {
          dirs.push(path);
          return Promise.resolve();
        },
        remove: (path: string) => {
          removed.push(path);
          return Promise.resolve();
        },
        makeTempDir: () => Promise.resolve("/tmp/vf-local-release-assets-test"),
        watch: () => {
          throw new Error("not implemented");
        },
      },
    },
  };
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

  afterEach(() => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag ?? "");
  });

  it("skips local dependency assets unless the dependency import-map flag is enabled", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "");
    const { adapter, writes } = makeAdapter();

    const manifest = await generateLocalReleaseAssetManifest({
      // deno-lint-ignore no-explicit-any
      adapter: adapter as any,
      projectDir: "/project",
      outputDir: "/project/dist",
      dryRun: false,
      vendorHttpImports: fakeVendorHttpImports,
    });

    assertEquals(manifest, null);
    assertEquals(writes.size, 0);
  });

  it("writes a local release asset manifest and React dependency assets when enabled", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, writes, removed } = makeAdapter();

    const manifest = await generateLocalReleaseAssetManifest({
      // deno-lint-ignore no-explicit-any
      adapter: adapter as any,
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

    const manifestText = writes.get("/project/dist/_veryfront/release-asset-manifest.json");
    assertExists(manifestText);
    const parsed = parseReleaseAssetManifest(JSON.parse(manifestText));
    assertExists(parsed);
    assertExists(parsed.dependencies.react);
    assertEquals(parsed.dependencies.react.contentHash, manifest.dependencies.react.contentHash);

    const reactAssetPath = `/project/dist/_vf/assets/${manifest.dependencies.react.contentHash}.js`;
    const reactAsset = writes.get(reactAssetPath);
    assertExists(reactAsset);
    assertEquals(reactAsset.includes("sourceUrl"), true);
    assertExists(manifest.dependencies["veryfront/head"]);
    assertExists(manifest.dependencies["veryfront/react/head"]);

    const headAssetPath = `/project/dist/_vf/assets/${
      manifest.dependencies["veryfront/head"].contentHash
    }.js`;
    const headAsset = writes.get(headAssetPath);
    assertExists(headAsset);
    assertStringIncludes(
      headAsset,
      `/_vf/assets/${manifest.dependencies.react.contentHash}.js`,
    );
    assertEquals(await hasEsmShReactImport(headAsset), false);
    assertEquals(removed.includes("/tmp/vf-local-release-assets-test"), true);
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

  it("fails the build when local React dependency assets cannot be vendored", async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const { adapter, removed } = makeAdapter();

    await assertRejects(
      () =>
        generateLocalReleaseAssetManifest({
          // deno-lint-ignore no-explicit-any
          adapter: adapter as any,
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
});
