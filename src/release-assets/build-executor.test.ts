import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ReleaseAssetBuildClient,
  type ReleaseAssetBuildInput,
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
      return Promise.resolve({ id: "b1", manifest_version: 1, state: "building" });
    },
    listAllReleaseFiles: () => Promise.resolve(files),
    uploadReleaseAsset: (_v, hash, contentType) => {
      rec.uploads.push({ hash, contentType });
      return Promise.resolve({ stored: true, existed: false });
    },
    putReleaseAssetManifest: (_v, manifest) => {
      rec.manifest = manifest;
      return Promise.resolve({ state: "ready", manifest_version: 1 });
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
    assertExists(manifest.modules["pages/index.tsx"]);
    assertExists(manifest.modules["components/Button.tsx"]);
    // README is not a browser module — excluded.
    assertEquals(manifest.modules["README.md"], undefined);
    // Page route maps to its module.
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
    const files = [{ path: "pages/index.tsx", content: 'export default () => "<div class=\\"p-4\\"/>";' }];
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
});
