import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
} from "./constants.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
} from "./manifest-cache.ts";
import { rewriteReleaseDependencyImportsForModule } from "./module-consumption.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";
import { normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function manifest(dependencies: ReleaseAssetManifest["dependencies"]): ReleaseAssetManifest {
  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: "project-id",
    releaseId: "release-id",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "test",
    sourceContentHash: "source",
    createdAt: new Date(0).toISOString(),
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencies,
    fallback: { mode: "jit", gaps: [] },
  };
}

describe("rewriteReleaseDependencyImportsForModule", () => {
  afterEach(() => {
    deleteEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
    deleteEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
    clearReleaseAssetManifestCache();
  });

  it("rewrites local HTTP bundle imports through their embedded source URL", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      })
    );

    const result = await rewriteReleaseDependencyImportsForModule(
      'import React from "file:///tmp/veryfront-http-bundle/http-123abc.mjs";\nexport default React;',
      {
        releaseId: "release-id",
        readDependencySource: () =>
          Promise.resolve(`/*! @vf-source: ${sourceUrl} */\nexport default {};`),
      },
    );

    assertEquals(result.includes(`"/_vf/assets/${HASH_A}.js"`), true);
    assertEquals(result.includes("file:///tmp/veryfront-http-bundle"), false);
  });

  it("rewrites esm.sh-wrapped local HTTP bundle imports", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      })
    );

    const result = await rewriteReleaseDependencyImportsForModule(
      'import React from "https://esm.sh/file:///tmp/veryfront-http-bundle/http-123abc.mjs?external=react&target=es2022";',
      {
        releaseId: "release-id",
        readDependencySource: () =>
          Promise.resolve(`/*! @vf-source: ${sourceUrl} */\nexport default {};`),
      },
    );

    assertEquals(result.includes(`"/_vf/assets/${HASH_A}.js"`), true);
    assertEquals(result.includes("https://esm.sh/file://"), false);
  });

  it("rewrites direct HTTP imports using normalized manifest dependency keys", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: manifest({
          [normalizeHttpUrl("https://esm.sh/pkg@1?z=2&a=1")]: {
            contentHash: HASH_B,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      })
    );

    const result = await rewriteReleaseDependencyImportsForModule(
      'import pkg from "https://esm.sh/pkg@1?z=2&a=1";',
      {
        releaseId: "release-id",
        readDependencySource: () => Promise.reject(new Error("unused")),
      },
    );

    assertEquals(result, `import pkg from "/_vf/assets/${HASH_B}.js";`);
  });

  it("does not rewrite when the dependency import-map flag is off", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const code = 'import React from "file:///tmp/veryfront-http-bundle/http-123abc.mjs";';

    const result = await rewriteReleaseDependencyImportsForModule(code, {
      releaseId: "release-id",
      readDependencySource: () => Promise.reject(new Error("unused")),
    });

    assertEquals(result, code);
  });

  it("does not invoke dependency accessors from an injected manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const code = 'import pkg from "https://example.test/pkg.js";';
    const accessorManifest = manifest({});
    let getterInvoked = false;
    Object.defineProperty(accessorManifest.dependencies, "https://example.test/pkg.js", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return {
          contentHash: HASH_A,
          size: 100,
          contentType: "text/javascript",
        };
      },
    });

    const result = await rewriteReleaseDependencyImportsForModule(code, {
      releaseId: "release-id",
      manifest: accessorManifest,
      readDependencySource: () => Promise.reject(new Error("unused")),
    });

    assertEquals(result, code);
    assertEquals(getterInvoked, false);
  });
});
