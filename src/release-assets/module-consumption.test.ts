import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
} from "./constants.ts";
import {
  clearReleaseAssetManifestCache,
  registerManifestFetcherForRelease,
} from "./manifest-cache.ts";
import {
  hasReleaseDependencyImportSpecifiers,
  rewriteReleaseDependencyImportsForModule,
} from "./module-consumption.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";
import { normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache-helpers.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function manifest(
  dependencies: ReleaseAssetManifest["dependencies"],
  dependencyMode: ReleaseAssetManifest["dependencyMode"] = "immutable",
): ReleaseAssetManifest {
  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: "project-id",
    releaseId: "release-id",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "test",
    sourceContentHash: "c".repeat(64),
    createdAt: new Date(0).toISOString(),
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencyMode,
    dependencies,
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
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));

    const result = await rewriteReleaseDependencyImportsForModule(
      'import React from "file:///tmp/veryfront-http-bundle/http-123abc.mjs";\nexport default React;',
      {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
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
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));

    const result = await rewriteReleaseDependencyImportsForModule(
      'import React from "https://esm.sh/file:///tmp/veryfront-http-bundle/http-123abc.mjs?external=react&target=es2022";',
      {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
        readDependencySource: () =>
          Promise.resolve(`/*! @vf-source: ${sourceUrl} */\nexport default {};`),
      },
    );

    assertEquals(result.includes(`"/_vf/assets/${HASH_A}.js"`), true);
    assertEquals(result.includes("https://esm.sh/file://"), false);
  });

  it("does not read matching bundle-shaped paths outside the owned cache root", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const sourceUrl = "https://esm.sh/react@19.2.4";
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));
    const code = 'import React from "file:///unowned/veryfront-http-bundle/http-123abc.mjs";';
    let reads = 0;

    const result = await rewriteReleaseDependencyImportsForModule(code, {
      releaseId: "release-id",
      dependencyCacheRoot: "/owned/veryfront-http-bundle",
      readDependencySource: () => {
        reads++;
        return Promise.resolve(`/*! @vf-source: ${sourceUrl} */`);
      },
    });

    assertEquals(result, code);
    assertEquals(reads, 0);
  });

  it("rewrites direct HTTP imports using normalized manifest dependency keys", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [normalizeHttpUrl("https://esm.sh/pkg@1?z=2&a=1")]: {
            contentHash: HASH_B,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));

    const result = await rewriteReleaseDependencyImportsForModule(
      'import pkg from "https://esm.sh/pkg@1?z=2&a=1";',
      {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
        readDependencySource: () => Promise.reject(new Error("unused")),
      },
    );

    assertEquals(result, `import pkg from "/_vf/assets/${HASH_B}.js";`);
  });

  it("preserves distinct HTTP fragment identities in immutable asset URLs", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const fragmentA = "https://cdn.example.com/pkg.js?z=2&a=1#a";
    const fragmentB = "https://cdn.example.com/pkg.js?z=2&a=1#b";
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [normalizeHttpUrl(fragmentA)]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
          [normalizeHttpUrl(fragmentB)]: {
            contentHash: HASH_B,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));

    const result = await rewriteReleaseDependencyImportsForModule(
      `import a from "${fragmentA}";\nimport b from "${fragmentB}";`,
      {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
        readDependencySource: () => Promise.reject(new Error("unused")),
      },
    );

    assertEquals(
      result,
      `import a from "/_vf/assets/${HASH_A}.js#a";\n` +
        `import b from "/_vf/assets/${HASH_B}.js#b";`,
    );
  });

  it("does not fall back from a fragment variant to a fragmentless dependency", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const fragmentless = "https://cdn.example.com/pkg.js";
    const code = `import value from "${fragmentless}#a";`;
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [fragmentless]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));

    const result = await rewriteReleaseDependencyImportsForModule(code, {
      releaseId: "release-id",
      dependencyCacheRoot: "/tmp/veryfront-http-bundle",
      readDependencySource: () => Promise.reject(new Error("unused")),
    });

    assertEquals(result, code);
  });

  it("does not use source-mode dependency entries as immutable assets", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const sourceUrl = "https://esm.sh/react@19.2.4?target=es2022";
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }, "source"),
      }));

    const result = await rewriteReleaseDependencyImportsForModule(
      `import React from "file:///tmp/veryfront-http-bundle/http-123abc.mjs";`,
      {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
        readDependencySource: () =>
          Promise.resolve(`/*! @vf-source: ${sourceUrl} */\nexport default {};`),
      },
    );

    assertEquals(result, `import React from "${sourceUrl}";`);
    assertEquals(result.includes(`/_vf/assets/${HASH_A}.js`), false);
    assertEquals(result.includes("file://"), false);
  });

  it("restores the verified HTTP source URL when the manifest is unavailable", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "building",
        manifest_version: 1,
        manifest: null,
      }));

    const result = await rewriteReleaseDependencyImportsForModule(
      'import React from "file:///tmp/veryfront-http-bundle/http-123abc.mjs";\nexport default React;',
      {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
        readDependencySource: () =>
          Promise.resolve(`/*! @vf-source: ${sourceUrl} */\nexport default {};`),
      },
    );

    assertEquals(result, `import React from "${sourceUrl}";\nexport default React;`);
    assertEquals(result.includes("file://"), false);
  });

  it("preserves the owned bundle import for unsafe embedded source markers", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "building",
        manifest_version: 1,
        manifest: null,
      }));
    const bundleUrl = "file:///tmp/veryfront-http-bundle/http-123abc.mjs";
    const code = `import value from "${bundleUrl}";`;
    const unsafeMarkers = [
      "file:///private/module.mjs",
      "data:text/javascript,export default 1",
      "https://user:secret@example.com/module.mjs",
      "https://example.com/module\u0000.mjs",
      `https://example.com/${"a".repeat(RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength)}`,
    ];

    for (const marker of unsafeMarkers) {
      const result = await rewriteReleaseDependencyImportsForModule(code, {
        releaseId: "release-id",
        dependencyCacheRoot: "/tmp/veryfront-http-bundle",
        readDependencySource: () =>
          Promise.resolve(`/*! @vf-source: ${marker} */\nexport default {};`),
      });

      assertEquals(result, code);
      assertEquals(await hasReleaseDependencyImportSpecifiers(result), true);
    }
  });

  it("does not rewrite when the dependency import-map flag is off", async () => {
    // Everything the rewrite needs is in place except the flag: a ready
    // manifest that maps the bundle's embedded source URL to an asset, so the
    // kill switch is the only thing keeping the import untouched.
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    registerManifestFetcherForRelease("release-id", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: manifest({
          [sourceUrl]: {
            contentHash: HASH_A,
            size: 100,
            contentType: "text/javascript",
          },
        }),
      }));
    const code = 'import React from "file:///tmp/veryfront-http-bundle/http-123abc.mjs";';

    const result = await rewriteReleaseDependencyImportsForModule(code, {
      releaseId: "release-id",
      dependencyCacheRoot: "/tmp/veryfront-http-bundle",
      readDependencySource: () =>
        Promise.resolve(`/*! @vf-source: ${sourceUrl} */\nexport default {};`),
    });

    assertEquals(
      result,
      code,
      "the disabled dependency import-map flag must leave imports untouched",
    );
    assertEquals(
      result.includes(HASH_A),
      false,
      "no asset URL may be substituted while the flag is off",
    );
  });
});
