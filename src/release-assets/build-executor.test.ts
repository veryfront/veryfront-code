import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ReleaseAssetBuildClient,
  type ReleaseAssetBuildInput,
  routeForPage,
  runReleaseAssetBuild,
} from "./build-executor.ts";
import { parseReleaseAssetManifest } from "./manifest-schema.ts";

interface Recorded {
  began: boolean;
  uploads: Array<{ hash: string; contentType: string }>;
  manifest: unknown;
  states: Array<{ state: string; error?: string }>;
}

function makeClient(
  files: Array<{ path: string; content?: string }>,
  rec: Recorded,
  overrides: Partial<ReleaseAssetBuildClient> = {},
): ReleaseAssetBuildClient {
  return {
    beginReleaseAssetManifestBuild: () => {
      rec.began = true;
      return Promise.resolve({ id: "b1", manifest_version: 7, state: "building" });
    },
    listAllReleaseFiles: () => Promise.resolve(files),
    uploadReleaseAsset: (_v, hash, contentType) => {
      rec.uploads.push({ hash, contentType });
      return Promise.resolve({ stored: true, existed: false });
    },
    putReleaseAssetManifest: (_v, manifest) => {
      rec.manifest = manifest;
      return Promise.resolve({ state: "ready", manifest_version: 7 });
    },
    reportReleaseAssetManifestState: (_v, state, error) => {
      rec.states.push({ state, error });
      return Promise.resolve(undefined);
    },
    ...overrides,
  };
}

function baseInput(
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetBuildInput["transform"],
): ReleaseAssetBuildInput {
  return {
    projectReference: "demo",
    projectId: "proj-uuid",
    releaseId: "rel-uuid",
    releaseVersion: 5,
    releaseVersionRef: "rel-uuid",
    adapter: {},
    client,
    transform,
  };
}

describe("release asset build executor", () => {
  const tempDirs: string[] = [];

  async function tmp(): Promise<string> {
    const dir = await Deno.makeTempDir({ prefix: "vf-rab-test-" });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    }
  });

  it("assembles a ready manifest from the module closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "components/Button.tsx", content: "export const Button = () => null;" },
      { path: "README.md", content: "# docs" },
    ];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(`/*t*/${source}`);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assert(rec.began);
    assertEquals(result.success, true);
    assertEquals(result.state, "ready");
    assertEquals(result.moduleCount, 2);

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.releaseVersion, 5);
    assertEquals(manifest.projectId, "proj-uuid");
    // H2: manifestVersion must come from begin's response (7), not hardcoded 1.
    assertEquals(manifest.manifestVersion, 7);
    assertExists(manifest.modules["pages/index.tsx"]);
    assertExists(manifest.modules["components/Button.tsx"]);
    // README is not a browser module — excluded.
    assertEquals(manifest.modules["README.md"], undefined);
    // Page route maps to its module (single module, no imports).
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx"]);
    // No CSS pipeline injected → css empty + gap recorded.
    assertEquals(manifest.css.length, 0);
    assert(manifest.fallback.gaps.includes("css:no-pipeline"));
    // Two distinct modules uploaded.
    assertEquals(rec.uploads.length, 2);
    assert(rec.uploads.every((u) => u.contentType === "text/javascript"));
  });

  it("reports failed and does not PUT on a transform error", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "boom" }];
    const client = makeClient(files, rec);
    const transform = () => Promise.reject(new Error("bad syntax in /secret/path.tsx"));

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    // Error is sanitized — no raw filesystem path leaks.
    assert(!(rec.states[0]?.error ?? "").includes("/secret/path.tsx"));
  });

  it("dedupes identical transformed bytes into a single upload", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/a.tsx", content: "same" },
      { path: "pages/b.tsx", content: "same" },
    ];
    const client = makeClient(files, rec);
    const transform = () => Promise.resolve("IDENTICAL");

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.moduleCount, 2);
    // Same bytes → same hash → one upload.
    assertEquals(rec.uploads.length, 1);
  });

  it("includes compiled CSS when a css pipeline is provided", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'export default () => "<div class=\\"p-4\\"/>";',
    }];
    const client = makeClient(files, rec, {
      compileProjectCss: () =>
        Promise.resolve({ css: ".p-4{padding:1rem}", styleProfileHash: "sp-1" }),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.cssCount, 1);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.css[0]?.styleProfileHash, "sp-1");
    assertEquals(manifest.css[0]?.contentType, "text/css");
  });

  // B2: route closure includes transitive imports, not just page entrypoint.
  it("includes transitive imports in route closure (B2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // Relative imports are resolved from the importing module's directory, so
    // pages/index.tsx uses "../components/Button.tsx" to reach components/.
    const files2 = [
      {
        path: "pages/index.tsx",
        content: 'import Button from "../components/Button.tsx"; export default () => null;',
      },
      {
        path: "components/Button.tsx",
        content: 'import Icon from "./Icon.tsx"; export default () => null;',
      },
      { path: "components/Icon.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files2, rec);
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);

    const routeModules = manifest.routes["/"]?.modules ?? [];
    // Must include all three modules, not just the page entrypoint.
    assert(routeModules.includes("pages/index.tsx"), "page entrypoint in route modules");
    assert(routeModules.includes("components/Button.tsx"), "Button.tsx in route closure");
    assert(routeModules.includes("components/Icon.tsx"), "Icon.tsx in route closure");
  });

  // H1: non-transform failures (e.g., listAllReleaseFiles throws) report failed.
  it("reports failed on non-transform build failure (H1)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([], rec, {
      listAllReleaseFiles: () => Promise.reject(new Error("network error in /internal/path")),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    // Error is sanitized.
    assert(!(rec.states[0]?.error ?? "").includes("/internal/path"));
  });

  // H1: PUT failure also reports failed.
  it("reports failed when putReleaseAssetManifest throws (H1)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec, {
      putReleaseAssetManifest: () => Promise.reject(new Error("PUT failed /secret")),
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    assert(!(rec.states[0]?.error ?? "").includes("/secret"));
  });

  // H2: manifestVersion from begin is used in the manifest body.
  it("uses manifest_version from beginReleaseAssetManifestBuild (H2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec, {
      beginReleaseAssetManifestBuild: () => {
        rec.began = true;
        return Promise.resolve({ id: "b2", manifest_version: 42, state: "building" });
      },
      putReleaseAssetManifest: (_v, manifest) => {
        rec.manifest = manifest;
        return Promise.resolve({ state: "ready", manifest_version: 42 });
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.manifestVersion, 42);
  });

  // M2: modules exceeding the 10 MB limit are skipped with a gap.
  it("skips oversized modules with a gap instead of uploading (M2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    // Return a string > 10 MB (10 * 1024 * 1024 + 1 bytes).
    const bigCode = "x".repeat(10 * 1024 * 1024 + 1);
    const transform = () => Promise.resolve(bigCode);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    // Module is skipped — not uploaded, not in manifest modules.
    assertEquals(rec.uploads.length, 0);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(Object.keys(manifest.modules).length, 0);
    // Gap is recorded.
    assert(result.gaps.some((g) => g.startsWith("oversized:")));
  });

  // L3: nested index route derivation.
  it("routeForPage derives nested index routes correctly (L3)", () => {
    assertEquals(routeForPage("pages/index.tsx"), "/");
    assertEquals(routeForPage("pages/about.tsx"), "/about");
    assertEquals(routeForPage("pages/blog/index.tsx"), "/blog");
    assertEquals(routeForPage("pages/blog/post.tsx"), "/blog/post");
    assertEquals(routeForPage("pages/a/b/index.tsx"), "/a/b");
    assertEquals(routeForPage("components/Button.tsx"), null);
  });
});

// B1: Two adapters with different releaseIds must each use the right fetcher.
describe("manifest fetcher registry (B1 multi-project isolation)", () => {
  it("each releaseId fetcher is registered and invoked independently", async () => {
    const { registerManifestFetcherForRelease, clearReleaseAssetManifestCache } = await import(
      "./manifest-cache.ts"
    );

    const calls: string[] = [];
    registerManifestFetcherForRelease("rel-A", async () => {
      calls.push("fetcher-A");
      return null;
    });
    registerManifestFetcherForRelease("rel-B", async () => {
      calls.push("fetcher-B");
      return null;
    });

    // Simulate enabling the flag and triggering fetches.
    const origEnv = Deno.env.get("VERYFRONT_RELEASE_ASSET_MANIFEST");
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");

    const { getReadyManifestForRender } = await import("./manifest-cache.ts");
    getReadyManifestForRender("rel-A");
    getReadyManifestForRender("rel-B");

    // Allow the background fetches to fire.
    await new Promise((r) => setTimeout(r, 10));

    // Each releaseId must have triggered its own fetcher (not the other's).
    assert(calls.includes("fetcher-A"), "fetcher-A was called for rel-A");
    assert(calls.includes("fetcher-B"), "fetcher-B was called for rel-B");
    // fetcher-A must not have been called for rel-B and vice versa.
    assertEquals(calls.filter((c) => c === "fetcher-A").length, 1);
    assertEquals(calls.filter((c) => c === "fetcher-B").length, 1);

    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", origEnv ?? "");
    clearReleaseAssetManifestCache();
  });
});
