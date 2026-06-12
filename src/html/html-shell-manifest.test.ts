import "#veryfront/schemas/_test-setup.ts";
import "./styles-builder/__tests__/css-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { afterEach, beforeEach } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { generateHTMLShellParts } from "./html-shell-generator.ts";
import type { RenderMetadata } from "#veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
} from "#veryfront/release-assets/manifest-cache.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

const PAGE_HASH = "a".repeat(64);

function meta(): RenderMetadata {
  return { title: "T", slug: "index", frontmatter: {} };
}

function prodOptions(overrides: Partial<HTMLGenerationOptions> = {}): HTMLGenerationOptions {
  return {
    mode: "production",
    config: { dev: { components: [] } },
    environment: "production",
    projectDir: "/proj",
    pagePath: "/proj/pages/index.tsx",
    projectSlug: "demo",
    ...overrides,
  };
}

function manifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "p",
    releaseId: "rel-1",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.765",
    sourceContentHash: "",
    createdAt: "2026-06-12T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {
      "pages/index.tsx": { contentHash: PAGE_HASH, size: 1, contentType: "text/javascript" },
    },
    css: [],
    routes: { "/": { modules: ["pages/index.tsx"], css: [] } },
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
}

async function primeReadyManifest(): Promise<void> {
  configureReleaseAssetManifestFetcher(() =>
    Promise.resolve({ state: "ready", manifest: manifest() })
  );
  // Render once to schedule + settle the background fetch, then clear nothing.
  await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
  await new Promise((r) => setTimeout(r, 0));
}

describe("html shell release asset manifest consumption", () => {
  const originalFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  beforeEach(() => clearReleaseAssetManifestCache());
  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalFlag ?? "");
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
  });

  it("is byte-identical with the flag off (no hashed URLs)", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    const withReleaseId = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    const withoutReleaseId = await generateHTMLShellParts(meta(), prodOptions());

    // No asset rewriting; falls back to /_vf_modules/* exactly as today.
    assert(!withReleaseId.start.includes("/_vf/assets/"));
    assertStringIncludes(withReleaseId.start, "/_vf_modules/pages/index.js");
    assertEquals(withReleaseId.start, withoutReleaseId.start);
  });

  it("emits a hashed asset URL for a covered page when the flag is on", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    await primeReadyManifest();

    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `/_vf/assets/${PAGE_HASH}.js`);
  });

  it("falls back to the existing URL for an uncovered page when the flag is on", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    await primeReadyManifest();

    const result = await generateHTMLShellParts(
      meta(),
      prodOptions({ releaseId: "rel-1", pagePath: "/proj/pages/uncovered.tsx" }),
    );
    assertStringIncludes(result.start, "/_vf_modules/pages/uncovered.js");
    assert(!result.start.includes(`/_vf/assets/${PAGE_HASH}.js`));
  });
});
