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
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { VERYFRONT_VERSION } from "#veryfront/utils/constants/cdn.ts";

const PAGE_HASH = "a".repeat(64);
const CHAT_HASH = "b".repeat(64);
const COMPONENT_HASH = "d".repeat(64);
const REACT_HASH = "e".repeat(64);

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

function extractImportMap(html: string): Record<string, string> {
  const match = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  assert(match?.[1], "expected an inline import map");
  return (JSON.parse(match[1]) as { imports?: Record<string, string> }).imports ?? {};
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

describe("html shell release asset manifest consumption", () => {
  const originalFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
  const originalDependencyFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);

  beforeEach(() => clearReleaseAssetManifestCache());
  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalFlag ?? "");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalDependencyFlag ?? "");
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
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `/_vf/assets/${PAGE_HASH}.js`);
  });

  it("version-stamps fallback module URLs when manifest lookup is enabled but unavailable", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(undefined);

    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));

    assertStringIncludes(result.start, "/_vf_modules/pages/index.js?vf_release=rel-1");
    assert(!result.start.includes("/_vf/assets/"));
  });

  it("uses manifest route closure preloads for index routes", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: {
          ...manifest(),
          modules: {
            "pages/index.tsx": {
              contentHash: PAGE_HASH,
              size: 1,
              contentType: "text/javascript",
            },
            "components/Hero.tsx": {
              contentHash: COMPONENT_HASH,
              size: 1,
              contentType: "text/javascript",
            },
          },
          routes: { "/": { modules: ["pages/index.tsx", "components/Hero.tsx"], css: [] } },
        },
      })
    );
    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `/_vf/assets/${COMPONENT_HASH}.js`);
  });

  it("emits the manifest CSS asset link when the manifest carries CSS", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const CSS_HASH = "c".repeat(64);
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: {
          ...manifest(),
          css: [{
            contentHash: CSS_HASH,
            size: 10,
            contentType: "text/css",
            styleProfileHash: "sp",
          }],
          routes: { "/": { modules: ["pages/index.tsx"], css: [CSS_HASH] } },
        },
      })
    );
    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `/_vf/assets/${CSS_HASH}.css`);
    // The JIT project-CSS link is replaced, not duplicated.
    assert(!result.start.includes("/_vf/css/"));
  });

  it("keeps covered HTTP import-map dependencies on CDN URLs by default", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: {
          ...manifest(),
          dependencies: {
            "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022": {
              contentHash: REACT_HASH,
              size: 10,
              contentType: "text/javascript",
            },
          },
        },
      })
    );
    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `"react":"https://esm.sh/react@19.2.4`);
    assert(!result.start.includes(`"react":"/_vf/assets/${REACT_HASH}.js"`));
    assertStringIncludes(result.start, `"react-dom/client":"https://esm.sh/react-dom@19.2.4`);
  });

  it("rewrites covered HTTP import-map dependencies when explicitly enabled", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: {
          ...manifest(),
          dependencies: {
            "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022": {
              contentHash: REACT_HASH,
              size: 10,
              contentType: "text/javascript",
            },
          },
        },
      })
    );
    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `"react":"/_vf/assets/${REACT_HASH}.js"`);
    assertStringIncludes(result.start, `"react-dom/client":"https://esm.sh/react-dom@19.2.4`);
  });

  it("uses one ready manifest snapshot on a cold first render", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: {
          ...manifest(),
          css: [{
            contentHash: "f".repeat(64),
            size: 10,
            contentType: "text/css",
            styleProfileHash: "sp",
          }],
          dependencies: {
            "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022": {
              contentHash: REACT_HASH,
              size: 10,
              contentType: "text/javascript",
            },
          },
        },
      })
    );

    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assertStringIncludes(result.start, `/_vf/assets/${PAGE_HASH}.js`);
    assertStringIncludes(result.start, `/_vf/assets/${"f".repeat(64)}.css`);
    assertStringIncludes(result.start, `"react":"https://esm.sh/react@19.2.4`);
  });

  it("treats an undefined manifest option as absent and fetches the ready manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    const result = await generateHTMLShellParts(
      meta(),
      prodOptions(
        {
          releaseId: "rel-1",
          releaseAssetManifest: undefined,
        } as Partial<HTMLGenerationOptions> & { releaseAssetManifest?: ReleaseAssetManifest },
      ),
    );

    assertStringIncludes(result.start, `/_vf/assets/${PAGE_HASH}.js`);
  });

  it("keeps covered framework import-map entries on the module-server path", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest: {
          ...manifest(),
          dependencies: {
            "veryfront/chat": {
              contentHash: CHAT_HASH,
              size: 10,
              contentType: "text/javascript",
            },
          },
        },
      })
    );
    const result = await generateHTMLShellParts(meta(), prodOptions({ releaseId: "rel-1" }));
    assert(!result.start.includes(`/_vf/assets/${CHAT_HASH}.js`));
    const imports = extractImportMap(result.start);
    assertEquals(
      imports["veryfront/chat"],
      `/_vf_modules/_veryfront/chat/index.js?vf_release=rel-1&vf_runtime=${VERYFRONT_VERSION}`,
    );
    assertEquals(imports["@/"], "/_vf_modules/");
  });

  it("falls back to the existing URL for an uncovered page when the flag is on", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    const result = await generateHTMLShellParts(
      meta(),
      prodOptions({ releaseId: "rel-1", pagePath: "/proj/pages/uncovered.tsx" }),
    );
    assertStringIncludes(result.start, "/_vf_modules/pages/uncovered.js");
    assert(!result.start.includes(`/_vf/assets/${PAGE_HASH}.js`));
  });
});
