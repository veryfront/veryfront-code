import "#veryfront/schemas/_test-setup.ts";
import "../transforms/plugins/__tests__/code-parser-setup.ts";
// Server MDX pages are compiled before their imports are collected, which
// resolves the ContentProcessor contract provided by @veryfront/ext-content-mdx.
import "../transforms/mdx/compiler/__tests__/content-processor-setup.ts";

import type { VeryfrontConfig } from "#veryfront/config";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join } from "#veryfront/compat/path";
import { normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { toScopedCssModuleClass } from "#veryfront/transforms/css-modules/naming.ts";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MAX_SIZE_BYTES,
} from "./constants.ts";
import {
  type ReleaseAssetBuildClient,
  type ReleaseAssetBuildInput,
  releaseAssetBuildInternals,
  type ReleaseAssetBuildResult,
  type ReleaseAssetHttpDependencyVendor,
  type ReleaseAssetVendorResult,
  routeForPage,
  runReleaseAssetBuild,
} from "./build-executor.ts";
import { parseReleaseAssetManifest, type ReleaseAssetManifest } from "./manifest-schema.ts";
import type { CompileProjectCssResult } from "./css-compile.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  clearReactVersionCache,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/parser/code-parser.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";

const STYLE_PROFILE_HASH = "d".repeat(64);
const CSS_PIPELINE_IDENTITY = "test-css-pipeline@1";

function compiledCss(
  css: string,
  styleProfileHash = STYLE_PROFILE_HASH,
  cssPipelineIdentity = CSS_PIPELINE_IDENTITY,
): CompileProjectCssResult {
  return { css, styleProfileHash, cssPipelineIdentity };
}

interface Recorded {
  began: boolean;
  uploads: Array<{ hash: string; contentType: string; text: string }>;
  manifest: unknown;
  states: Array<{ state: string; error?: string }>;
}

function makeClient(
  files: Array<{ path: string; content: string }>,
  rec: Recorded,
  overrides: Partial<ReleaseAssetBuildClient> = {},
): ReleaseAssetBuildClient {
  return {
    beginReleaseAssetManifestBuild: () => {
      rec.began = true;
      return Promise.resolve({ id: "b1", manifest_version: 7, state: "building" });
    },
    listAllReleaseFiles: () => Promise.resolve(files),
    uploadReleaseAsset: (_v, hash, contentType, bytes) => {
      rec.uploads.push({ hash, contentType, text: new TextDecoder().decode(bytes) });
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
    compileProjectCss: () => Promise.resolve(compiledCss("/* test release CSS */")),
    ...overrides,
  };
}

function assertCoverageFailure(
  result: ReleaseAssetBuildResult,
  rec: Recorded,
  expectedFailure: string,
): void {
  assertEquals(result.success, false);
  assertEquals(result.state, "failed");
  assertEquals(rec.manifest, null);
  assertEquals(rec.uploads, []);
  assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  assert(
    result.coverageFailures.some((failure) => failure.startsWith(expectedFailure)),
    `expected coverage failure ${JSON.stringify(expectedFailure)} in ${
      JSON.stringify(result.coverageFailures)
    }`,
  );
}

function releaseConfigLoader(
  config: Partial<VeryfrontConfig> = {},
): ReleaseAssetBuildInput["loadConfig"] {
  return () =>
    Promise.resolve({
      ...config,
      experimental: {
        ...config.experimental,
        rsc: config.experimental?.rsc ?? true,
      },
    } as VeryfrontConfig);
}

function baseInput(
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetBuildInput["transform"],
): ReleaseAssetBuildInput {
  const immutableDependencies = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
  return {
    projectReference: "demo",
    projectId: "proj-uuid",
    releaseId: "rel-uuid",
    releaseVersion: 5,
    releaseVersionRef: "rel-uuid",
    adapter: {} as RuntimeAdapter,
    dependencyMode: immutableDependencies ? "immutable" : "source",
    loadConfig: releaseConfigLoader(),
    client,
    transform,
    ...(immutableDependencies ? { vendorHttpImports: fakeVendorHttpImports } : {}),
  };
}

function fakeHttpCachePath(url: string): string {
  const hash = Array.from(new TextEncoder().encode(url))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `/tmp/veryfront-http-bundle/http-${hash}.mjs`;
}

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

async function moduleSpecifiers(code: string): Promise<string[]> {
  return (await parseImports(code))
    .map((imp) => imp.n)
    .filter((specifier): specifier is string => typeof specifier === "string");
}

function fakeVendorHttpImports(code: string): Promise<ReleaseAssetVendorResult> {
  const urls = [
    ...new Set(
      [...code.matchAll(/["'](https?:\/\/[^"']+)["']/g)]
        .map((match) => match[1])
        .filter((url): url is string => typeof url === "string"),
    ),
  ];
  let rewritten = code;
  const dependencies = urls.map((url) => {
    const sourcePath = fakeHttpCachePath(url);
    rewritten = rewritten.replaceAll(url, `file://${sourcePath}`);
    return {
      specifier: `file://${sourcePath}`,
      manifestKey: url,
      sourcePath,
      code: `export const sourceUrl = ${JSON.stringify(url)};`,
    };
  });

  return Promise.resolve({ code: rewritten, dependencies });
}

async function fakeNormalizedVendorHttpImports(code: string): Promise<ReleaseAssetVendorResult> {
  const result = await fakeVendorHttpImports(code);
  return {
    code: result.code,
    dependencies: result.dependencies.map((dependency) => ({
      ...dependency,
      manifestKey: normalizeHttpUrl(dependency.manifestKey),
    })),
  };
}

function withFakeReactVendor(
  vendor: ReleaseAssetHttpDependencyVendor,
): ReleaseAssetHttpDependencyVendor {
  return (code, options) => {
    if (code.includes("https://esm.sh/react@") || code.includes("https://esm.sh/react-dom@")) {
      return fakeVendorHttpImports(code);
    }
    return vendor(code, options);
  };
}

describe("release asset build executor", () => {
  const tempDirs: string[] = [];
  const originalDependencyFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
  const originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

  async function tmp(): Promise<string> {
    const dir = await Deno.makeTempDir({ prefix: "vf-rab-test-" });
    tempDirs.push(dir);
    return dir;
  }

  function enableDependencyImportMap(): void {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
  }

  afterEach(async () => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalDependencyFlag ?? "");
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalPinningFlag ?? "");
    clearReactVersionCache();
    for (const dir of tempDirs.splice(0)) {
      await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  it("assembles a ready manifest from the module closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "pages/api/hello.ts", content: "export function GET() {}" },
      { path: "pages/_app.tsx", content: "export default ({ Component }) => <Component />;" },
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
    // Pages Router API and reserved framework files are not browser routes.
    assertEquals(manifest.modules["pages/api/hello.ts"], undefined);
    assertEquals(manifest.modules["pages/_app.tsx"], undefined);
    // Page route maps to its module (single module, no imports).
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx"]);
    assertEquals(manifest.css.length, 1);
    // Project modules, framework dependencies, and compiled CSS are uploaded.
    assert(rec.uploads.length >= 2);
    assert(rec.uploads.some((u) => u.contentType === "text/javascript"));
    assert(rec.uploads.some((u) => u.contentType === "text/css"));
  });

  it("assembles App Router page routes from app/page modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/page.tsx", content: '"use client"; export default () => null;' },
      { path: "app/about/page.tsx", content: '"use client"; export default () => null;' },
      {
        path: "app/layout.tsx",
        content: '"use client"; export default ({ children }) => children;',
      },
      { path: "app/api/ag-ui/route.ts", content: "export async function POST() {}" },
    ];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.modules["app/page.tsx"]);
    assertExists(manifest.modules["app/about/page.tsx"]);
    assertExists(manifest.modules["app/layout.tsx"]);
    assertEquals(manifest.modules["app/api/ag-ui/route.ts"], undefined);
    assertEquals(manifest.routes["/"]?.modules, ["app/page.tsx", "app/layout.tsx"]);
    assertEquals(manifest.routes["/about"]?.modules, ["app/about/page.tsx", "app/layout.tsx"]);
    assertEquals(routeForPage("app/layout.tsx"), null);
  });

  it("publishes App Router pages when RSC is explicitly disabled", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/page.tsx", content: "export default function Page() { return null; }" },
      {
        path: "app/layout.tsx",
        content: "export default function Layout({ children }) { return children; }",
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild({
      ...baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({ experimental: { rsc: false } }),
    }, await tmp());

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.modules["app/page.tsx"]);
    assertExists(manifest.modules["app/layout.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["app/page.tsx", "app/layout.tsx"]);
  });

  it("rejects function-local server actions in non-RSC App Router entries", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'export async function save() { "use server"; return "<SECRET>"; } ' +
          "export default function Page() { return save; }",
      },
      {
        path: "app/layout.tsx",
        content: "export default function Layout({ children }) { return children; }",
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild({
      ...baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({ experimental: { rsc: false } }),
    }, await tmp());

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
  });

  it("rejects module-level use server in non-RSC App Router entries", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: '"use server"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild({
      ...baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({ experimental: { rsc: false } }),
    }, await tmp());

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["app/page.tsx"], undefined);
  });

  it("does not publish App Router server modules or their server-only imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content:
          'import "./private.ts"; import Client from "./client.tsx"; export default () => <Client />;',
      },
      { path: "app/private.ts", content: 'export const value = "<REDACTED>";' },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["app/page.tsx"], undefined);
    assertEquals(manifest.modules["app/private.ts"], undefined);
    assertExists(manifest.modules["app/client.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("does not let a client component promote a directive-less App Router entry", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import OtherPage from "./other/page.tsx"; ' +
          "export default () => <OtherPage />;",
      },
      {
        path: "app/other/page.tsx",
        content: 'export default () => "<REDACTED>";',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/other"]?.modules, []);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["app/other/page.tsx"], undefined);
    assert(rec.uploads.every((upload) => !upload.text.includes("<REDACTED>")));
  });

  it("does not let a client component promote a directive-less App Router layout", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import OtherLayout from "./other/layout.tsx"; ' +
          "export default () => <OtherLayout />;",
      },
      {
        path: "app/other/layout.tsx",
        content: 'export default () => "<REDACTED>";',
      },
      { path: "app/other/page.tsx", content: "export default function Page() { return null; }" },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/other"]?.modules, []);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["app/other/layout.tsx"], undefined);
    assert(rec.uploads.every((upload) => !upload.text.includes("<REDACTED>")));
  });

  it("drops an App Router route whose entry has conflicting directives", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: '"use client"; "use server"; export default () => "<REDACTED>";',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("<REDACTED>")));
  });

  it("drops an App Router route whose outside dependency has conflicting directives", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Conflict from "../shared/conflict.tsx"; ' +
          "export default () => <Conflict />;",
      },
      {
        path: "shared/conflict.tsx",
        content: '"use client"; "use server"; export default () => "<REDACTED>";',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("<REDACTED>")));
  });

  it("allows supported JSON imports in App Router server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import data from "./data.json" with { type: "json" }; ' +
          'import Client from "./client.tsx"; export default () => <Client data={data} />;',
      },
      { path: "app/data.json", content: '{"label":"server only"}' },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
    assertEquals(manifest.modules["app/data.json"], undefined);
  });

  it("drops an App Router route whose JSON import omits its type attribute", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import data from "./data.json"; import Client from "./client.tsx"; ' +
          "export default () => <Client data={data} />;",
      },
      { path: "app/data.json", content: '{"label":"server only"}' },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("drops an App Router route whose direct remote JSON import omits its type attribute", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import data from "https://cdn.example/config.json"; ' +
          'import Client from "./client.tsx"; export default () => <Client data={data} />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("treats bare package aliases ending in .json as packages", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "deno.json", content: '{"imports":{"#config":"pkg.json"}}' },
      {
        path: "app/page.tsx",
        content: 'import config from "#config"; import Client from "./client.tsx"; ' +
          "export default () => <Client config={config} />;",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("drops an App Router route whose JSON alias omits its type attribute", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#data":"/_vf_modules/app/data.json"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import data from "#data"; import Client from "./client.tsx"; ' +
          "export default () => <Client data={data} />;",
      },
      { path: "app/data.json", content: '{"label":"server only"}' },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("allows a JSON alias with its type attribute in an App Router server module", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#data":"/_vf_modules/app/data.json"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import data from "#data" with { type: "json" }; ' +
          'import Client from "./client.tsx"; export default () => <Client data={data} />;',
      },
      { path: "app/data.json", content: '{"label":"server only"}' },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
    assertEquals(manifest.modules["app/data.json"], undefined);
  });

  it("drops an App Router route whose JSON data URL omits its type attribute", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import data from "data:application/json,%7B%22label%22%3A%22inline%22%7D"; ' +
          'import Client from "./client.tsx"; export default () => <Client data={data} />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("drops an App Router route that directly imports a CSS data URL", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import "data:text/css,body%7Bcolor%3Ared%7D"; ' +
          'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("allows a JSON data URL with its type attribute in an App Router server module", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content:
          'import data from "data:application/problem+json,%7B%22label%22%3A%22inline%22%7D" with { type: "json" }; ' +
          'import Client from "./client.tsx"; export default () => <Client data={data} />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("resolves project import-map aliases while traversing server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"/_vf_modules/app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("keeps relative server imports ahead of import-map entries", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"./client.tsx":"https://cdn.example/client.js"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("resolves project import-map aliases throughout the browser closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#helper":"/_vf_modules/app/helper.ts"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import { helper } from "#helper"; ' +
          "export default function Client() { return helper; }",
      },
      { path: "app/helper.ts", content: "export const helper = null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx", "app/helper.ts"]);
    const clientHash = manifest.modules["app/client.tsx"]?.contentHash;
    const helperHash = manifest.modules["app/helper.ts"]?.contentHash;
    assertExists(clientHash);
    assertExists(helperHash);
    const clientUpload = rec.uploads.find((upload) => upload.hash === clientHash);
    assertExists(clientUpload);
    assertStringIncludes(clientUpload.text, `"/_vf/assets/${helperHash}.js"`);
  });

  it("keeps relative browser imports ahead of import-map entries", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"./client.tsx":"https://cdn.example/client.js"}}',
      },
      {
        path: "pages/index.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "pages/client.tsx",
        content: "export default function Client() { return null; }",
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx", "pages/client.tsx"]);
    const entryHash = manifest.modules["pages/index.tsx"]?.contentHash;
    const clientHash = manifest.modules["pages/client.tsx"]?.contentHash;
    assertExists(entryHash);
    assertExists(clientHash);
    const entryUpload = rec.uploads.find((upload) => upload.hash === entryHash);
    assertExists(entryUpload);
    assertStringIncludes(entryUpload.text, `"/_vf/assets/${clientHash}.js"`);
    assert(!entryUpload.text.includes("https://cdn.example/client.js"));
  });

  it("canonicalizes bare package import-map targets in source dependency mode", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#ui":"browser-ui-package"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import ui from "#ui"; export default () => ui;',
      },
    ];
    const input = baseInput(makeClient(files, rec), (source) => Promise.resolve(source));

    const result = await runReleaseAssetBuild(
      { ...input, dependencyMode: "source", vendorHttpImports: undefined },
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const clientHash = manifest.modules["app/client.tsx"]?.contentHash;
    assertExists(clientHash);
    const clientUpload = rec.uploads.find((upload) => upload.hash === clientHash);
    assertExists(clientUpload);
    assertStringIncludes(clientUpload.text, "https://esm.sh/browser-ui-package?target=node");
  });

  it("uses the longest project import-map prefix during server traversal", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: JSON.stringify({
          imports: {
            "#/": "/_vf_modules/short/",
            "#/nested/": "/_vf_modules/long/",
          },
        }),
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#/nested/client.tsx"; export default () => <Client />;',
      },
      {
        path: "short/nested/client.tsx",
        content: '"use client"; export default function Short() { return null; }',
      },
      {
        path: "long/client.tsx",
        content: '"use client"; export default function Long() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["long/client.tsx"]);
    assertEquals(manifest.modules["short/nested/client.tsx"], undefined);
  });

  it("applies package mappings to esm.sh server imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"widget":"/_vf_modules/app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "https://esm.sh/widget@1"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("keeps esm.sh package mappings to remote targets external", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"widget":"https://esm.sh/widget@2"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import "https://esm.sh/widget@1"; ' +
          'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("drops a server route whose alias maps to an external stylesheet", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#theme":"https://cdn.example/theme.css?release"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import "#theme"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("validates JSON data URLs after resolving server aliases", async () => {
    for (
      const [attribute, publishesRoute] of [
        ["", false],
        [' with { type: "json" }', true],
      ] as const
    ) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const files = [
        {
          path: "deno.json",
          content:
            '{"imports":{"#data":"data:application/problem+json,%7B%22label%22%3A%22inline%22%7D"}}',
        },
        {
          path: "app/page.tsx",
          content: `import data from "#data"${attribute}; export default () => data;`,
        },
        { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
      ];

      const result = await runReleaseAssetBuild(
        baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, true, result.error);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      assertEquals(manifest.routes["/"] !== undefined, publishesRoute);
      assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    }
  });

  it("resolves chained project import-map aliases while traversing server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: JSON.stringify({
          imports: {
            "#entry": "#client",
            "#client": "/_vf_modules/app/client.tsx",
          },
        }),
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#entry"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("drops an App Router route whose project import-map aliases form a cycle", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: JSON.stringify({ imports: { "#first": "#second", "#second": "#first" } }),
      },
      {
        path: "app/page.tsx",
        content: 'import "#first"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("treats native and bare import-map alias targets as external server imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: JSON.stringify({
          imports: {
            "#native": "node:fs",
            "#package": "installed-server-package",
          },
        }),
      },
      {
        path: "app/page.tsx",
        content: 'import "#native"; import "#package"; ' +
          'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("keeps protocol-relative server imports outside the project graph", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import "//cdn.example/sdk.js"; import Client from "./client.tsx"; ' +
          "export default () => <Client />;",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      {
        path: "cdn.example/sdk.js",
        content: '"use client"; export const sdk = "must stay external";',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
    assertEquals(manifest.modules["cdn.example/sdk.js"], undefined);
  });

  it("drops an App Router route that imports an existing file outside the release root", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const outerDir = await tmp();
    const releaseDir = join(outerDir, "release");
    await Deno.mkdir(releaseDir);
    await Deno.writeTextFile(join(outerDir, "outside.ts"), "export const secret = true;");
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { secret } from "../../outside.ts"; export default () => secret;',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      releaseDir,
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("traverses mjs server helpers to find nested client boundaries", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { renderClient } from "./server-helper.mjs"; ' +
          "export default () => renderClient();",
      },
      {
        path: "app/server-helper.mjs",
        content: 'import Client from "./client.tsx"; ' +
          "export const renderClient = () => Client();",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["app/server-helper.mjs"], undefined);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("prefers an mjs server helper over an mdx fallback", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { renderClient } from "app/helper"; export default () => renderClient();',
      },
      {
        path: "app/helper.mjs",
        content:
          'import Client from "./mjs-client.tsx"; export const renderClient = () => Client();',
      },
      {
        path: "app/helper.mdx",
        content: 'import Client from "./mdx-client.tsx"\n\n<Client />',
      },
      {
        path: "app/mjs-client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      {
        path: "app/mdx-client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/mjs-client.tsx"]);
    assertEquals(manifest.modules["app/mdx-client.tsx"], undefined);
  });

  it("uses hosted extension priority for relative server imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { renderClient } from "./helper"; export default () => renderClient();',
      },
      {
        path: "app/helper.mdx",
        content: 'import Client from "./mdx-client.tsx"\n\n<Client />',
      },
      {
        path: "app/helper.tsx",
        content:
          'import Client from "./tsx-client.tsx"; export const renderClient = () => Client();',
      },
      {
        path: "app/mdx-client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      {
        path: "app/tsx-client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/mdx-client.tsx"]);
    assertEquals(manifest.modules["app/tsx-client.tsx"], undefined);
  });

  it("strips a Windows materialization root before hosted extension lookup", () => {
    assertEquals(
      releaseAssetBuildInternals.releaseLogicalPathFromMaterializedPath(
        "C:\\release\\app\\helper",
        "C:\\release",
        "windows",
      ),
      "app/helper",
    );
  });

  it("drops routes that import unsupported server script extensions", async () => {
    for (const extension of [".cjs", ".mts", ".cts"]) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const files = [
        {
          path: "app/page.tsx",
          content: `import { renderClient } from "./helper${extension}"; ` +
            "export default () => renderClient();",
        },
        {
          path: `app/helper${extension}`,
          content: 'import Client from "./client.tsx"; export const renderClient = () => Client();',
        },
        {
          path: "app/client.tsx",
          content: '"use client"; export default function Client() { return null; }',
        },
        { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
      ];

      const result = await runReleaseAssetBuild(
        baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, true, `${extension}: ${result.error}`);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      assertEquals(manifest.routes["/"], undefined, extension);
      assertExists(manifest.routes["/ok"]);
    }
  });

  it("does not source-fallback an absent CommonJS server import", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { renderClient } from "./helper.cjs"; ' +
          "export default () => renderClient();",
      },
      {
        path: "app/helper.tsx",
        content: 'import Client from "./client.tsx"; export const renderClient = () => Client();',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("drops a server route with an unresolved cross-project import", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const result = await runReleaseAssetBuild(
      baseInput(
        makeClient([
          {
            path: "app/page.tsx",
            content: 'import "demo/@/components/Card"; export default () => null;',
          },
          { path: "pages/ok.tsx", content: "export default () => null;" },
        ], rec),
        (source) => Promise.resolve(source),
      ),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("resolves Markdown imports from App Router server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import "./content.md"; import Client from "./client.tsx"; ' +
          "export default () => <Client />;",
      },
      { path: "app/content.md", content: "# Content" },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("classifies the complete server closure before generic browser seeds", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { mid } from "../lib/mid.ts"; ' +
          'import Client from "./client.tsx"; export default () => <Client value={mid} />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      {
        path: "lib/mid.ts",
        content: 'import { leaf } from "./a-leaf.ts"; export const mid = leaf;',
      },
      {
        path: "lib/a-leaf.ts",
        content: 'import { secret } from "./z-secret.ts"; export const leaf = secret;',
      },
      { path: "lib/z-secret.ts", content: 'export const secret = "<SECRET>";' },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
    for (const serverPath of ["lib/mid.ts", "lib/a-leaf.ts", "lib/z-secret.ts"]) {
      assertEquals(manifest.modules[serverPath], undefined);
    }
    assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
  });

  it("initializes the default parser before inspecting browser boundaries", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const previousParser = tryResolve<CodeParser>("CodeParser");
    unregister("CodeParser");
    try {
      const result = await runReleaseAssetBuild(
        baseInput(
          makeClient([
            {
              path: "pages/index.tsx",
              content: "export default function Page() { return null; }",
            },
          ], rec),
          (source) => Promise.resolve(source),
        ),
        await tmp(),
      );

      assertEquals(result.success, true, result.error);
      assertExists(parseReleaseAssetManifest(rec.manifest)?.routes["/"]);
    } finally {
      unregister("CodeParser");
      if (previousParser) register("CodeParser", previousParser);
    }
  });

  it("resolves extension-fallback import-map aliases while traversing server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"/_vf_modules/app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client.js"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("excludes JSON when JavaScript-suffixed server imports use source fallbacks", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#alias":"/_vf_modules/app/alias-helper.js"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Direct from "app/direct-helper.js"; ' +
          'import Alias from "#alias"; export default () => <><Direct /><Alias /></>;',
      },
      { path: "app/direct-helper.json", content: "{}" },
      {
        path: "app/direct-helper.tsx",
        content: '"use client"; export default function Direct() { return null; }',
      },
      { path: "app/alias-helper.json", content: "{}" },
      {
        path: "app/alias-helper.tsx",
        content: '"use client"; export default function Alias() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, [
      "app/direct-helper.tsx",
      "app/alias-helper.tsx",
    ]);
  });

  it("applies a configured @/ mapping before the default project-root alias", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"@/":"/_vf_modules/src/"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "@/Client.tsx"; export default () => <Client />;',
      },
      {
        path: "src/Client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["src/Client.tsx"]);
  });

  it("resolves import-map aliases targeting a relative _vf_modules path", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"_vf_modules/app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("resolves import-map aliases targeting the project @/ alias", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"@/components/Client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "components/Client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["components/Client.tsx"]);
  });

  it("preserves the local @/ module when its import-map target is external", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"@/Widget":"https://example.com/external-widget.js"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Widget from "@/Widget"; export default () => <Widget />;',
      },
      {
        path: "Widget.tsx",
        content: '"use client"; export default function Widget() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["Widget.tsx"]);
  });

  it("filters project-relative aliases to match the runtime import map", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"./app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("ignores deno.jsonc import aliases like the runtime loader", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.jsonc",
        content: '{"imports":{"#client":"/_vf_modules/app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("rejects JSONC syntax in deno.json like the runtime loader", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{\n// comment\n"imports":{"#client":"/_vf_modules/app/client.tsx"}\n}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("ignores the complete Deno import map when an entry is invalid", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"/_vf_modules/app/client.tsx","#invalid":42}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("rejects noncanonical local import-map targets", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#bare":"app/client.tsx","#root":"/app/client.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Bare from "#bare"; import Root from "#root"; ' +
          "export default () => <><Bare /><Root /></>;",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("does not publish an unvendored browser alias outside the script CSP", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#sdk":"https://example.com/sdk.js"}}',
      },
      {
        path: "pages/index.tsx",
        content: 'import { sdk } from "#sdk"; export default function Page() { return sdk; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("https://example.com/sdk.js")));
  });

  it("does not publish browser routes whose aliases target server-only packages", async () => {
    for (
      const [target, serverExternalPackages] of [
        ["pg", undefined],
        ["npm:redis@5", undefined],
        ["knex", ["knex"]],
      ] as const
    ) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const files = [
        {
          path: "deno.json",
          content: JSON.stringify({ imports: { "#database": target } }),
        },
        {
          path: "pages/index.tsx",
          content:
            'import database from "#database"; export default function Page() { return database; }',
        },
        { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
      ];
      const input = baseInput(makeClient(files, rec), (source) => Promise.resolve(source));

      const result = await runReleaseAssetBuild(
        {
          ...input,
          loadConfig: releaseConfigLoader({
            build: serverExternalPackages
              ? { serverExternalPackages: [...serverExternalPackages] }
              : {},
          }),
        },
        await tmp(),
      );

      assertEquals(result.success, true, result.error);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      assertEquals(manifest.routes["/"], undefined, `server-only alias was published: ${target}`);
      assertExists(manifest.routes["/ok"]);
    }
  });

  it("does not publish browser routes whose aliases target external stylesheets", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#theme":"https://example.com/theme.css"}}',
      },
      {
        path: "pages/index.tsx",
        content: '"use client"; import "#theme"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("theme.css")));
  });

  it("vendors an external browser alias in immutable dependency mode", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#sdk":"https://example.com/sdk.js"}}',
      },
      {
        path: "pages/index.tsx",
        content: 'import { sdk } from "#sdk"; export default function Page() { return sdk; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const hash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(hash);
    const upload = rec.uploads.find((candidate) => candidate.hash === hash);
    assertExists(upload);
    assert(!upload.text.includes("#sdk"));
    assert(!upload.text.includes("https://example.com/sdk.js"));
    assertStringIncludes(upload.text, "/_vf/assets/");
  });

  it("does not publish a protocol-relative browser alias outside the script CSP", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#sdk":"//cdn.example.com/sdk.js"}}',
      },
      {
        path: "pages/index.tsx",
        content: 'import { sdk } from "#sdk"; export default function Page() { return sdk; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("cdn.example.com/sdk.js")));
  });

  it("vendors a protocol-relative external browser alias in immutable dependency mode", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#sdk":"//cdn.example.com/sdk.js"}}',
      },
      {
        path: "pages/index.tsx",
        content: 'import { sdk } from "#sdk"; export default function Page() { return sdk; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const hash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(hash);
    const upload = rec.uploads.find((candidate) => candidate.hash === hash);
    assertExists(upload);
    assert(!upload.text.includes("#sdk"));
    assert(!upload.text.includes("cdn.example.com/sdk.js"));
    assertStringIncludes(upload.text, "/_vf/assets/");
  });

  it("resolves veryfront.config import-map aliases while traversing server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // No deno.json at all: the alias exists only in veryfront.config.ts under
    // resolve.importMap.imports, the second supported alias source.
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild({
      ...baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({
        resolve: { importMap: { imports: { "#client": "/_vf_modules/app/client.tsx" } } },
      }),
    }, await tmp());

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("ignores a malformed optional Deno map while retaining config aliases", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "deno.json", content: "not valid json{" },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild({
      ...baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({
        resolve: { importMap: { imports: { "#client": "/_vf_modules/app/client.tsx" } } },
      }),
    }, await tmp());

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("ignores project overrides for framework-owned import-map aliases", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content: JSON.stringify({
          imports: {
            react: "./app/missing-react.ts",
            "veryfront/router": "./app/missing-router.ts",
          },
        }),
      },
      {
        path: "app/page.tsx",
        content: 'import React from "react"; import "veryfront/router"; ' +
          'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("lets a veryfront.config alias override the deno.json mapping", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // Same key in both sources: the config mapping must win, mirroring
    // loadImportMap's serve-time merge order (deno.json first, config last).
    const files = [
      {
        path: "deno.json",
        content: '{"imports":{"#client":"/_vf_modules/app/decoy.tsx"}}',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "#client"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      {
        path: "app/decoy.tsx",
        content: '"use client"; export default function Decoy() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild({
      ...baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({
        resolve: { importMap: { imports: { "#client": "/_vf_modules/app/client.tsx" } } },
      }),
    }, await tmp());

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("resolves directory-index imports from App Router server modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "app/client"; export default () => <Client />;',
      },
      {
        path: "app/client/index.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client/index.tsx"]);
  });

  it("resolves suffixed server imports instead of dropping the route", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // A query or fragment on a supported specifier is not part of the file
    // path; before suffix splitting both imports were reported missing and the
    // only route was dropped, failing the release.
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx#island"; ' +
          'import { copy } from "@/lib/copy.ts?raw"; ' +
          "export default () => <Client label={copy} />;",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "lib/copy.ts", content: 'export const copy = "text";' },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.modules["app/client.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("publishes app/ helpers that inherit the client boundary from their importer", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // The server page reaches shared.ts first, parking it as a server module;
    // the client component then imports the same helper, which must promote it
    // back into the browser closure or Counter's import cannot be rewritten.
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { shared } from "./shared.ts"; import Counter from "./counter.tsx"; ' +
          "export default () => <Counter label={shared} />;",
      },
      { path: "app/shared.ts", content: 'export const shared = "label";' },
      {
        path: "app/counter.tsx",
        content: '"use client"; import { shared } from "./shared.ts"; ' +
          "export default function Counter() { return shared; }",
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["app/page.tsx"], undefined);
    assertExists(manifest.modules["app/counter.tsx"]);
    assertExists(manifest.modules["app/shared.ts"]);
    assertEquals(
      [...(manifest.routes["/"]?.modules ?? [])].sort(),
      ["app/counter.tsx", "app/shared.ts"],
    );
  });

  it("preserves server reachability when a shared module fails client promotion", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { value } from "../server/shared.ts"; export default () => value;',
      },
      {
        path: "pages/broken.tsx",
        content: 'import { value } from "../server/shared.ts"; export default () => value;',
      },
      {
        path: "server/shared.ts",
        content: 'export async function action() { "use server"; return "ok"; } ' +
          'export const value = "ok";',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, []);
    assertEquals(manifest.routes["/broken"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["server/shared.ts"], undefined);
  });

  it("preserves each server edge when a shared browser module fails finalization", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { value } from "../server/shared.ts"; export default () => value;',
      },
      {
        path: "pages/broken.tsx",
        content: 'import { value } from "../server/shared.ts"; export default () => value;',
      },
      { path: "server/shared.ts", content: 'export const value = "ok";' },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];
    const transform = (source: string, filePath: string) =>
      Promise.resolve(
        filePath.endsWith("server/shared.ts")
          ? 'import "./missing.ts"; export const value = "ok";'
          : source,
      );

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), transform),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, []);
    assertEquals(manifest.routes["/broken"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["server/shared.ts"], undefined);
  });

  it("drops a Pages Router entry with a module-level use server directive", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: '"use server"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["pages/index.tsx"], undefined);
  });

  it("never grants client trust to a use server module imported by a client boundary", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import { act } from "./actions.ts"; ' +
          "export default function Client() { return act; }",
      },
      { path: "app/actions.ts", content: '"use server"; export const act = "<SECRET>";' },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    // The client boundary cannot resolve its server-action import in the
    // browser, so its route fails closed instead of publishing the action.
    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["app/actions.ts"], undefined);
    assertEquals(manifest.routes["/"], undefined, "route with a server-action import is dropped");
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(
      rec.uploads.every((upload) => !upload.text.includes("<SECRET>")),
      "use server module content must never be uploaded",
    );
  });

  it("never publishes a client module containing a function-local server action", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; async function save() { "use server"; return "<SECRET>"; } ' +
          "export default function Client() { return save; }",
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
  });

  it("never publishes an outside-app client module containing a server action", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "../components/Client.tsx"; ' +
          "export default () => <Client />;",
      },
      {
        path: "components/Client.tsx",
        content: '"use client"; async function save() { "use server"; return "<SECRET>"; } ' +
          "export default function Client() { return save; }",
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.modules["components/Client.tsx"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
  });

  it("inspects directive-less dependencies inherited by an outside-app client", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import { save } from "../components/actions.ts"; ' +
          "export default function Client() { return save; }",
      },
      {
        path: "components/actions.ts",
        content: 'export async function save() { "use server"; return "<SECRET>"; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.modules["components/actions.ts"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
  });

  for (const protectedPath of ["app/api/users/route.ts", "tools/private.ts"] as const) {
    it(`never publishes protected client dependency ${protectedPath}`, async () => {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const relativeImport = protectedPath.startsWith("app/")
        ? `./${protectedPath.slice("app/".length)}`
        : `../${protectedPath}`;
      const files = [
        {
          path: "app/page.tsx",
          content: 'import Client from "./client.tsx"; export default () => <Client />;',
        },
        {
          path: "app/client.tsx",
          content: `"use client"; import { secret } from ${JSON.stringify(relativeImport)}; ` +
            "export default function Client() { return secret; }",
        },
        { path: protectedPath, content: 'export const secret = "<SECRET>";' },
        { path: "pages/ok.tsx", content: "export default () => null;" },
      ];

      const result = await runReleaseAssetBuild(
        baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, true, result.error);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      assertEquals(manifest.routes["/"], undefined);
      assertEquals(manifest.modules[protectedPath], undefined);
      assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
    });
  }

  it("drops a server route that imports a protected explicit client boundary", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { secret } from "./api/users/route.ts"; export default () => secret;',
      },
      {
        path: "app/api/users/route.ts",
        content: '"use client"; export const secret = "<SECRET>";',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["app/api/users/route.ts"], undefined);
    assert(rec.uploads.every((upload) => !upload.text.includes("<SECRET>")));
  });

  it("queues client boundaries imported through project-root specifiers", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // Server pages can import client boundaries with the same project-root
    // specifier forms the browser collector supports; dropping any of them
    // would publish the route without its hydration JavaScript.
    const files = [
      {
        path: "app/page.tsx",
        content: 'import A from "app/client-a.tsx"; ' +
          'import B from "/app/client-b.tsx"; ' +
          'import C from "/_vf_modules/app/client-c.tsx"; ' +
          "export default () => <><A /><B /><C /></>;",
      },
      {
        path: "app/client-a.tsx",
        content: '"use client"; export default function A() { return null; }',
      },
      {
        path: "app/client-b.tsx",
        content: '"use client"; export default function B() { return null; }',
      },
      {
        path: "app/client-c.tsx",
        content: '"use client"; export default function C() { return null; }',
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, `root-form imports must resolve: ${result.error}`);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["app/page.tsx"], undefined);
    assertExists(manifest.modules["app/client-a.tsx"]);
    assertExists(manifest.modules["app/client-b.tsx"]);
    assertExists(manifest.modules["app/client-c.tsx"]);
    assertEquals(
      [...(manifest.routes["/"]?.modules ?? [])].sort(),
      ["app/client-a.tsx", "app/client-b.tsx", "app/client-c.tsx"],
    );
  });

  for (const extension of ["js", "ts"] as const) {
    it(`queues client boundaries required through a .${extension} server helper`, async () => {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const files = [
        {
          path: "app/page.tsx",
          content: `import helper from "./helper.${extension}"; export default () => helper;`,
        },
        {
          path: `app/helper.${extension}`,
          content: 'module.exports = require("./client.tsx");',
        },
        {
          path: "app/client.tsx",
          content: '"use client"; export default function Client() { return null; }',
        },
      ];

      const result = await runReleaseAssetBuild(
        baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, true, result.error);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
      assertEquals(manifest.modules[`app/helper.${extension}`], undefined);
    });
  }

  for (
    const missingSpecifier of [
      "app/missing.tsx",
      "/app/missing.tsx",
      "/_vf_modules/app/missing.tsx",
    ]
  ) {
    it(`drops a server route with missing project-root import ${missingSpecifier}`, async () => {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient([
        {
          path: "app/page.tsx",
          content: `import Missing from ${JSON.stringify(missingSpecifier)}; ` +
            "export default () => <Missing />;",
        },
        { path: "pages/ok.tsx", content: "export default () => null;" },
      ], rec);

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, true);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      assertEquals(manifest.routes["/"], undefined);
      assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    });
  }

  it("counts a missing ESM and CommonJS server specifier once", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import "app/missing.ts"; require("app/missing.ts"); ' +
          "export default () => null;",
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];
    const records: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      if (entry.component === "release-asset-build") records.push(entry);
    });
    let result: ReleaseAssetBuildResult;
    try {
      result = await runReleaseAssetBuild(
        baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
        await tmp(),
      );
    } finally {
      unsubscribe();
    }

    assertEquals(result.success, true, result.error);
    const failure = records.find((entry) =>
      entry.message === "Server module import parse failed during release asset build" &&
      entry.context?.path === "app/page.tsx"
    );
    assertStringIncludes(String(failure?.context?.error), "1 unresolved project import(s)");
  });

  it("drops a server route with a computed dynamic import", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([
      {
        path: "app/page.tsx",
        content: 'const target = "./client.tsx"; ' +
          "export default async function Page() { await import(target); return null; }",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ], rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("applies the server boundary to modules outside the app directory", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    // Modules reached through a server-module edge are server code wherever
    // they live: an explicit "use server" action and a plain helper outside
    // the app root must both stay off the release.
    const files = [
      {
        path: "app/page.tsx",
        content: 'import { act } from "../server/actions.ts"; ' +
          'import { data } from "../server/data.ts"; ' +
          'import Client from "./client.tsx"; ' +
          "export default () => <Client act={act} data={data} />;",
      },
      { path: "server/actions.ts", content: '"use server"; export const act = "<SECRET>";' },
      { path: "server/data.ts", content: 'export const data = "<REDACTED>";' },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, `server imports must stay server-side: ${result.error}`);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["server/actions.ts"], undefined);
    assertEquals(manifest.modules["server/data.ts"], undefined);
    assertExists(manifest.modules["app/client.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
    assert(
      rec.uploads.every(
        (upload) => !upload.text.includes("<SECRET>") && !upload.text.includes("<REDACTED>"),
      ),
      "server module content must never be uploaded",
    );
  });

  it("preserves the server boundary inside configured browser seed directories", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "src/server/data.ts", content: 'export const data = "<REDACTED>";' },
      {
        path: "src/app/page.tsx",
        content: 'import { data } from "../server/data.ts"; ' +
          'import Client from "./client.tsx"; ' +
          "export default () => <Client data={data} />;",
      },
      {
        path: "src/app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild({
      ...baseInput(client, (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({
        directories: { app: "src/app", pages: "src/pages" },
      }),
    }, await tmp());

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["src/server/data.ts"], undefined);
    assertExists(manifest.modules["src/app/client.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["src/app/client.tsx"]);
    assert(
      rec.uploads.every((upload) => !upload.text.includes("<REDACTED>")),
      "a server-only src dependency must never be uploaded",
    );
  });

  it("never publishes an outside-app use server module imported by a client boundary", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; import { act } from "../server/actions.ts"; ' +
          "export default function Client() { return act; }",
      },
      { path: "server/actions.ts", content: '"use server"; export const act = "<SECRET>";' },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    // Same fail-closed behavior as an in-app server action: the route that
    // needs the action in the browser is dropped rather than published with
    // server source.
    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["server/actions.ts"], undefined);
    assertEquals(manifest.routes["/"], undefined, "route with a server-action import is dropped");
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assert(
      rec.uploads.every((upload) => !upload.text.includes("<SECRET>")),
      "use server module content must never be uploaded",
    );
  });

  it("does not publish targets of type-only imports from server pages", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import type { Model } from "../server/models.ts"; ' +
          'import Client from "./client.tsx"; ' +
          "export default () => <Client model={null as unknown as Model} />;",
      },
      { path: "server/models.ts", content: "export type Model = { secret: string };" },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertEquals(rec.uploads.length > 0, true);
    assertExists(manifest);
    assertEquals(manifest.modules["server/models.ts"], undefined);
    assertExists(manifest.modules["app/client.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
  });

  it("keeps CSS imports out of the server module closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/globals.css", content: "body { margin: 0; }" },
      {
        path: "app/layout.tsx",
        content: 'import "./globals.css"; export default ({ children }) => children;',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss("body{margin:0}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    // The stylesheet edge must not become a closure gap for the route; it is
    // merged into the release CSS instead.
    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"]?.modules, ["app/client.tsx"]);
    assertExists(seenStylesheet);
    assert(seenStylesheet!.includes("margin: 0"), "layout CSS merged into release stylesheet");
  });

  it("merges CSS re-exported by a server module", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/globals.css", content: "body { margin: 0; }" },
      { path: "app/Button.module.css", content: ".button { color: red; }" },
      {
        path: "app/layout.tsx",
        content: 'export * from "./globals.css";\n' +
          'export { default as styles } from "./Button.module.css";\n' +
          "export default ({ children }) => children;",
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss("body{margin:0}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, "margin: 0");
    assertStringIncludes(seenStylesheet, "color: red");
  });

  it("ignores CSS import and re-export text in comments and strings", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; }" },
      { path: "app/legacy.css", content: ".legacy { color: red; }" },
      { path: "app/quoted.css", content: ".quoted { color: purple; }" },
      {
        path: "app/layout.tsx",
        content: '// import "./legacy.css";\n' +
          '// export * from "./legacy.css";\n' +
          "const imported = 'import \"./quoted.css\"';\n" +
          "const exported = 'export * from \"./quoted.css\"';\n" +
          "export default ({ children }) => <main>{children}</main>;",
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(":root{--brand:blue}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, "--brand: blue");
    assertEquals(seenStylesheet.includes(".legacy"), false);
    assertEquals(seenStylesheet.includes(".quoted"), false);
  });

  it("ignores CSS referenced only by type-only declarations", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; }" },
      { path: "app/import-type.css", content: ".import-type { color: red; }" },
      { path: "app/export-type.css", content: ".export-type { color: purple; }" },
      { path: "app/inline-type.css", content: ".inline-type { color: orange; }" },
      {
        path: "app/layout.tsx",
        content: 'import type Styles from "./import-type.css";\n' +
          'export type { Classes } from "./export-type.css";\n' +
          'import { type Tokens } from "./inline-type.css";\n' +
          "export default ({ children }) => <main>{children}</main>;",
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(":root{--brand:blue}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, "--brand: blue");
    assertEquals(seenStylesheet.includes(".import-type"), false);
    assertEquals(seenStylesheet.includes(".export-type"), false);
    assertEquals(seenStylesheet.includes(".inline-type"), false);
  });

  it("merges a CSS import whose default binding is named type", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/theme.css", content: ".theme { color: green; }" },
      {
        path: "app/layout.tsx",
        content: 'import type from "./theme.css"; export default () => type;',
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".theme{color:green}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, ".theme { color: green; }");
  });

  it("finds CSS after the static import match budget in generated source", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const ordinaryImports = Array.from(
      // Match the build executor's release-file/scanner bound. Before the
      // matcher became CSS-specific, these unrelated edges consumed it all.
      { length: 50_000 },
      () => 'import"pkg";',
    ).join("");
    const files = [
      { path: "styles/late.css", content: ".late { color: blue; }" },
      {
        path: "tools/generated.ts",
        content: `${ordinaryImports}import styles from "../styles/late.css";`,
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".late{color:blue}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, ".late { color: blue; }");
  });

  it("merges a CSS alias but drops the server route that still executes it", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "deno.json",
        content:
          '{"imports":{"#theme":"/_vf_modules/styles/theme.css","theme":"/_vf_modules/styles/bare.css","theme/":"/_vf_modules/styles/"}}',
      },
      { path: "styles/theme.css", content: ":root { --theme-color: blue; }" },
      { path: "styles/bare.css", content: ".bare { color: green; }" },
      { path: "styles/prefix.css", content: ".prefix { color: purple; }" },
      {
        path: "app/layout.tsx",
        content:
          'import "#theme"; import "theme"; import "theme/prefix.css"; export default ({ children }) => children;',
      },
      {
        path: "app/page.tsx",
        content: 'import Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(":root{--theme-color:blue}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, "--theme-color: blue");
    assertStringIncludes(seenStylesheet, ".bare { color: green; }");
    assertStringIncludes(seenStylesheet, ".prefix { color: purple; }");
  });

  it("merges CSS imported by an mjs server helper", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const extensions = ["mjs"];
    const files = [
      {
        path: "app/page.tsx",
        content: extensions.map((ext) => `import "./helper.${ext}";`).join("\n") +
          '\nimport Client from "./client.tsx"; export default () => <Client />;',
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      ...extensions.flatMap((ext) => [
        {
          path: `app/helper.${ext}`,
          content: `import "./helper-${ext}.css"; export const value = "${ext}";`,
        },
        { path: `app/helper-${ext}.css`, content: `.${ext} { --format: ${ext}; }` },
      ]),
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss("/* server formats */"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    for (const ext of extensions) {
      assert(
        seenStylesheet!.includes(`.${ext} { --format: ${ext}; }`),
        `CSS imported by .${ext} must be merged`,
      );
    }
  });

  it("collects imports from server MDX pages by compiling the MDX first", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.mdx",
        content: "import Widget from './widget.tsx'\n\n# Hello\n\n" +
          "It's prose, not JavaScript, and the lexer must never see it raw.\n\n<Widget />\n",
      },
      {
        path: "app/widget.tsx",
        content: '"use client"; export default function Widget() { return null; }',
      },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["app/page.mdx"], undefined);
    assertExists(manifest.modules["app/widget.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["app/widget.tsx"]);
  });

  it("drops only the affected route when a server page cannot be analyzed", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      // Unclosed JSX makes the MDX compile throw, so this server page's
      // imports cannot be discovered. That must cost this page its route, not
      // the release.
      { path: "app/broken/page.mdx", content: "# Broken\n\n<Unclosed\n" },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, `healthy routes must publish: ${result.error}`);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/broken"], undefined, "unanalyzable route is dropped");
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("drops a server route with an unresolved local import", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/broken/page.tsx",
        content: 'import "./missing.ts"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/broken"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
  });

  it("drops a server route with a case-insensitive local file URL", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "app/page.tsx",
        content: 'import "FILE:///tmp/secret.mjs"; export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertExists(manifest.routes["/ok"]);
  });

  it("drops App Router routes that import static assets as modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/logo.png", content: "png-bytes" },
      { path: "app/icon.svg", content: "<svg></svg>" },
      { path: "app/fonts/brand.woff2", content: "font-bytes" },
      {
        path: "app/page.tsx",
        content: 'import logo from "./logo.png";\n' +
          'import "./icon.svg";\n' +
          'import "./fonts/brand.woff2";\n' +
          'import Client from "./client.tsx";\n' +
          "export default () => <Client src={logo} />;",
      },
      {
        path: "app/client.tsx",
        content: '"use client"; export default function Client() { return null; }',
      },
      {
        path: "app/commonjs/page.tsx",
        content: 'require("../logo.png"); export default function Page() { return null; }',
      },
      { path: "pages/ok.tsx", content: "export default function Ok() { return null; }" },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.routes["/"], undefined);
    assertEquals(manifest.routes["/commonjs"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"]);
    assertEquals(manifest.modules["app/logo.png"], undefined);
    assertEquals(manifest.modules["app/icon.svg"], undefined);
    assertEquals(manifest.modules["app/fonts/brand.woff2"], undefined);
  });

  it("rejects release file paths outside the materialization directory", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const tempDir = await tmp();
    const escapedName = `vf-release-escape-${crypto.randomUUID()}.tsx`;
    const escapedPath = join(tempDir, "..", escapedName);
    const client = makeClient(
      [{ path: `../${escapedName}`, content: "export default null;" }],
      rec,
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      tempDir,
    );

    assertEquals(result.success, false);
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
    assertEquals(await Deno.stat(escapedPath).then(() => true, () => false), false);
  });

  it("rejects changing release file accessors before they can bypass size validation", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let pathReads = 0;
    let contentReads = 0;
    const file: Record<string, unknown> = {};
    Object.defineProperty(file, "path", {
      enumerable: true,
      get() {
        pathReads++;
        return "pages/index.tsx";
      },
    });
    Object.defineProperty(file, "content", {
      enumerable: true,
      get() {
        contentReads++;
        return contentReads < 3
          ? "export default null;"
          : "x".repeat(RELEASE_ASSET_MAX_SIZE_BYTES + 1);
      },
    });
    const client = makeClient([], rec, {
      listAllReleaseFiles: () =>
        Promise.resolve([
          file as unknown as { path: string; content: string },
        ]),
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, () => Promise.resolve("export default null;")),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(pathReads, 0);
    assertEquals(contentReads, 0);
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  });

  it("rejects release file proxies whose own data properties cannot be inspected", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const file = new Proxy(
      { path: "pages/index.tsx", content: "export default null;" },
      {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor access denied");
        },
      },
    );
    const client = makeClient([], rec, {
      listAllReleaseFiles: () => Promise.resolve([file]),
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  });

  it("keeps transformed HTTP imports on their source URLs by default", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import React from "react"; export default React;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import React from "https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3"; export default React;',
      );

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.dependencies.react, undefined);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(
      pageUpload.text.includes(
        '"https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3"',
      ),
    );
    assert(!pageUpload.text.includes("/_vf/assets/"));
  });

  it("uses the explicit source dependency mode regardless of the consumer flag", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const sourceUrl = "https://cdn.example.com/dependency.js#source";
    const client = makeClient(
      [{ path: "pages/index.tsx", content: `import ${JSON.stringify(sourceUrl)};` }],
      rec,
    );
    const transform = (source: string) => Promise.resolve(source);

    const result = await runReleaseAssetBuild({
      ...baseInput(client, transform),
      dependencyMode: "source",
      vendorHttpImports: undefined,
    }, await tmp());

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.dependencyMode, "source");
    assertEquals(Object.keys(manifest.dependencies), []);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);
    assertStringIncludes(rec.uploads.find((upload) => upload.hash === pageHash)!.text, sourceUrl);
  });

  it("rejects immutable dependency mode without a vendor before materialization", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
    );
    const tempDir = await tmp();

    const result = await runReleaseAssetBuild({
      ...baseInput(client, (source) => Promise.resolve(source)),
      dependencyMode: "immutable",
      vendorHttpImports: undefined,
    }, tempDir);

    assertEquals(result.success, false);
    assertStringIncludes(
      result.error ?? "",
      "Immutable release dependencies require a policy-enforced vendor extension",
    );
    assertEquals(rec.began, false);
    assertEquals(rec.uploads, []);
    assertEquals([...Deno.readDirSync(tempDir)], []);
  });

  it("never admits a module whose transform failed", async () => {
    // Previously this failed the whole build. It no longer does -- a broken page
    // costs only its own route -- but the safety half still holds: the module
    // that failed must never reach the manifest, so the browser-module endpoint
    // keeps refusing it.
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "pages/broken.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/broken.tsx")) {
        return Promise.reject(new Error("Invalid left-hand side in prefix operation. (1:2)"));
      }
      return Promise.resolve("export default () => null;");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.modules["pages/broken.tsx"], undefined);
    assertEquals(manifest.routes["/broken"], undefined);
    // The healthy page is unaffected.
    assertExists(manifest.modules["pages/index.tsx"]);
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx"]);
  });

  it("fails closed when HTTP dependency vendoring fails", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const reactUrl = "https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3";
    const transform = () =>
      Promise.resolve(`import React from "${reactUrl}"; export default React;`);
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: () =>
        Promise.reject(new Error("Invalid left-hand side in prefix operation. (1:2)")),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "module-dependency-vendor-failed:pages/index.tsx");
    assert(result.coverageFailures.includes("dependency-vendor-failed:react-import-map"));
  });

  it("bounds dependency aliases and atomically discards an oversized vendor batch", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const sourceUrl = "https://cdn.example/dependency.js";
    const dependencyCode = "export const dependencyAliasBoundary = true;";
    const files = [{
      path: "pages/index.tsx",
      content: `import ${JSON.stringify(sourceUrl)}; export default null;`,
    }];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);
    const vendorHttpImports = withFakeReactVendor((code: string) =>
      Promise.resolve({
        code,
        dependencies: Array.from(
          { length: RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries },
          (_, index) => ({
            specifier: `dependency-alias-${index}`,
            manifestKey: sourceUrl,
            code: dependencyCode,
          }),
        ),
      })
    );

    const result = await runReleaseAssetBuild(
      { ...baseInput(client, transform), vendorHttpImports },
      await tmp(),
    );

    assertCoverageFailure(result, rec, "dependency-finalize-failed");
  });

  it("rejects accessor-backed vendor results without executing accessors", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default null;" }];
    const client = makeClient(files, rec);
    let accessorCalls = 0;
    const hostileResult: Record<string, unknown> = {};
    Object.defineProperty(hostileResult, "code", {
      get() {
        accessorCalls++;
        return "export default null;";
      },
    });
    Object.defineProperty(hostileResult, "dependencies", {
      value: [],
      enumerable: true,
    });

    const result = await runReleaseAssetBuild(
      {
        ...baseInput(client, (source) => Promise.resolve(source)),
        vendorHttpImports: withFakeReactVendor(() =>
          Promise.resolve(hostileResult as unknown as ReleaseAssetVendorResult)
        ),
      },
      await tmp(),
    );

    assertCoverageFailure(
      result,
      rec,
      "module-dependency-vendor-failed:pages/index.tsx",
    );
    assertEquals(accessorCalls, 0);
  });

  it("never publishes project modules with unresolved local file imports", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default null;" }];
    const client = makeClient(files, rec);

    const result = await runReleaseAssetBuild(
      {
        ...baseInput(client, (source) => Promise.resolve(source)),
        vendorHttpImports: withFakeReactVendor(() =>
          Promise.resolve({
            code: 'import "file:///tmp/unresolved-release-dependency.mjs"; export default null;',
            dependencies: [],
          })
        ),
      },
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/index.tsx");
  });

  it("publishes healthy routes when one page has an unresolvable import", async () => {
    // A production outage: one leftover scratch page imported a URL that had
    // since become a sign-in redirect. Its coverage gap failed the entire
    // manifest, so the renderer had no manifest to admit against and 503'd
    // every browser module on every route -- the whole site went dead over one
    // page nothing linked to. The broken page must cost only itself.
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "pages/scratch.tsx", content: 'import "./missing.ts"; export default null;' },
    ], rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true);
    assertEquals(result.state, "ready");

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    // The healthy page ships and stays admissible.
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx"]);
    assertExists(manifest.modules["pages/index.tsx"]);
    // The broken page ships nowhere: no route, and no manifest entry, so the
    // browser-module endpoint still refuses it rather than serving a hole.
    assertEquals(manifest.routes["/scratch"], undefined);
    assertEquals(manifest.modules["pages/scratch.tsx"], undefined);
  });

  it("drops a route whose layout is missing from the manifest instead of publishing a hole", async () => {
    // An App Router layout is an extra closure entrypoint the page never
    // imports, so a page can be admitted while its closure still has a hole.
    // Shipping that route would hand the browser an import map pointing at a
    // module the admission boundary refuses.
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([
      { path: "app/page.tsx", content: '"use client"; export default () => null;' },
      {
        path: "app/layout.tsx",
        content: '"use client"; export default function Layout({ children }) { return children; }',
      },
      { path: "pages/ok.tsx", content: "export default () => null;" },
    ], rec);
    const transform = (source: string, sourceFile: string) => {
      if (sourceFile.endsWith("app/layout.tsx")) {
        return Promise.reject(new Error("Invalid left-hand side in prefix operation. (1:2)"));
      }
      return Promise.resolve(source);
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true, "one unbuildable layout must not fail the release");
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(
      manifest.routes["/"],
      undefined,
      "a route whose closure member has no manifest entry must be omitted, not published without it",
    );
    // The page itself was admitted, so the route really was a candidate and
    // the drop came from the closure gap rather than from the page failing.
    assertExists(manifest.modules["app/page.tsx"]);
    assertEquals(manifest.modules["app/layout.tsx"], undefined);
    assertEquals(manifest.routes["/ok"]?.modules, ["pages/ok.tsx"], "healthy routes still publish");
  });

  it("still fails closed when every page fails to transform", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "pages/other.tsx", content: "export default () => null;" },
    ], rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, () => Promise.reject(new Error("compile error"))),
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-transform-failed:pages/");
  });

  it("still fails closed when every page is unbuildable", async () => {
    // Degrading per route must not become "publish an empty manifest". With no
    // serveable route left there is nothing to ship, so the build fails and the
    // previous release keeps serving.
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([
      { path: "pages/index.tsx", content: 'import "./missing.ts"; export default null;' },
      { path: "pages/other.tsx", content: 'import "./gone.ts"; export default null;' },
    ], rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/");
  });

  it("never publishes project modules with unresolved relative imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: 'import "./missing.ts"; export default null;' }],
      rec,
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/index.tsx");
  });

  it("never publishes non-literal dynamic imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([{
      path: "pages/index.tsx",
      content: 'const name = "feature"; export default import("./" + name);',
    }], rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/index.tsx");
  });

  it("rejects HTTP imports retained by a composed vendor", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const sourceUrl = "https://cdn.example/retained.js";
    const client = makeClient(
      [{ path: "pages/index.tsx", content: `import ${JSON.stringify(sourceUrl)};` }],
      rec,
    );
    const vendorHttpImports = withFakeReactVendor((code) =>
      Promise.resolve({ code, dependencies: [] })
    );

    const result = await runReleaseAssetBuild(
      {
        ...baseInput(client, (source) => Promise.resolve(source)),
        vendorHttpImports,
      },
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/index.tsx");
  });

  it("rejects case-insensitive local file URL schemes", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([{
      path: "pages/index.tsx",
      content: 'import "FILE:///tmp/secret.mjs"; export default null;',
    }], rec);

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/index.tsx");
  });

  it("fails closed when React import-map dependency vendoring fails", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: () =>
        Promise.reject(new Error("Invalid left-hand side in prefix operation. (1:2)")),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "dependency-vendor-failed:react-import-map");
  });

  it("records React import-map dependencies without publishing unused framework modules", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string, sourceFile: string) =>
      Promise.resolve(`/*${sourceFile}*/\n${source}`);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.dependencies.react);
    assertExists(manifest.dependencies["react-dom"]);
    assertExists(manifest.dependencies["react-dom/client"]);
    assertExists(manifest.dependencies["react/jsx-runtime"]);
    assertExists(manifest.dependencies["react/jsx-dev-runtime"]);
    assertEquals(manifest.dependencies["veryfront/chat"], undefined);
    assertEquals(manifest.dependencies["veryfront/workflow"], undefined);
    assertEquals(manifest.dependencies["veryfront/head"], undefined);
  });

  it("keeps framework dependency assets on the vendored React instance", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const frameworkUrl = "/_vf_modules/_veryfront/react/runtime/core.js";
    const files = [{
      path: "pages/blog.mdx",
      content: 'import { Head } from "veryfront/head"; export default Head;',
    }];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/blog.mdx")) {
        return Promise.resolve(`import { Head } from "${frameworkUrl}"; export default Head;`);
      }
      if (sourceFile.endsWith("src/react/runtime/core.ts")) {
        return Promise.resolve(
          'import React, { useEffect } from "https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3"; export function Head() { useEffect(() => {}, []); return React.createElement("div"); }',
        );
      }
      return Promise.resolve("export const value = true;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const reactHash = manifest.dependencies.react?.contentHash;
    const headHash = manifest.dependencies["veryfront/head"]?.contentHash;
    const pageHash = manifest.modules["pages/blog.mdx"]?.contentHash;
    assertExists(reactHash);
    assertExists(headHash);
    assertExists(pageHash);

    const headUpload = rec.uploads.find((u) => u.hash === headHash);
    assertExists(headUpload);
    assert(headUpload.text.includes(`"/_vf/assets/${reactHash}.js"`));
    assertEquals(await hasEsmShReactImport(headUpload.text), false);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${headHash}.js"`));
    assert(!pageUpload.text.includes(frameworkUrl));
  });

  it("finalizes dependency-pinned project module paths", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const pinnedChild =
      "https://preview.example.test/_vf_modules/_pins/on%3Asnapshot-a/components/Child.js?v=1#child";
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import Child from "@/components/Child"; export default Child;',
      },
      {
        path: "components/Child.tsx",
        content: "export default function Child() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) =>
      Promise.resolve(
        sourceFile.endsWith("pages/index.tsx")
          ? `import Child from ${JSON.stringify(pinnedChild)}; export default Child;`
          : "export default function Child() { return null; }",
      );

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const childHash = manifest.modules["components/Child.tsx"]?.contentHash;
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(childHash);
    assertExists(pageHash);
    const pageUpload = rec.uploads.find((upload) => upload.hash === pageHash);
    assertExists(pageUpload);
    assertStringIncludes(pageUpload.text, `"/_vf/assets/${childHash}.js"`);
    assertEquals(pageUpload.text.includes("/_vf_modules/_pins/"), false);
  });

  it("discovers dependency-pinned framework module paths", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const pinnedHead =
      "/_vf_modules/_pins/on%3Asnapshot-a/_veryfront/react/runtime/core.js?v=1#head";
    const pinnedUi =
      "https://preview.example.test/_vf_modules/_pins/on%3Asnapshot-a/_veryfront/react/components/ui/index.js?v=1#ui";
    const files = [{
      path: "pages/index.tsx",
      content: 'import { Head } from "veryfront/head"; export default Head;',
    }];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          `import { Head } from ${JSON.stringify(pinnedHead)}; export default Head;`,
        );
      }
      if (sourceFile.endsWith("src/react/runtime/core.ts")) {
        return Promise.resolve(
          `import { ColorModeProvider } from ${JSON.stringify(pinnedUi)}; ` +
            "export function Head() { return ColorModeProvider; }",
        );
      }
      return Promise.resolve("export function ColorModeProvider() { return null; }");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const headHash = manifest.dependencies["veryfront/head"]?.contentHash;
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(headHash);
    assertExists(pageHash);
    const pageUpload = rec.uploads.find((upload) => upload.hash === pageHash);
    const headUpload = rec.uploads.find((upload) => upload.hash === headHash);
    assertExists(pageUpload);
    assertExists(headUpload);
    assertStringIncludes(pageUpload.text, `"/_vf/assets/${headHash}.js"`);
    assertEquals(pageUpload.text.includes("/_vf_modules/_pins/"), false);
    const headSpecifiers = await moduleSpecifiers(headUpload.text);
    assertEquals(headSpecifiers.length, 1);
    assert(headSpecifiers[0]?.startsWith("/_vf/assets/"));
    assertEquals(headUpload.text.includes("/_vf_modules/_pins/"), false);
  });

  it("fails closed on malformed dependency-pinning module paths", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'import Child from "@/components/Child"; export default Child;',
    }];
    const transform = () =>
      Promise.resolve(
        'import Child from "/_vf_modules/_pins/%E0%A4%A/components/Child.js"; ' +
          "export default Child;",
      );

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), transform),
      await tmp(),
    );

    assertCoverageFailure(result, rec, "module-rewrite-failed:pages/index.tsx");
  });

  it("rewrites transitive framework dependency imports to immutable assets", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const fontsUrl = "/_vf_modules/_veryfront/react/fonts/index.js";
    const files = [{
      path: "pages/fonts.mdx",
      content: 'import { FontHead } from "veryfront/fonts"; export default FontHead;',
    }];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/fonts.mdx")) {
        return Promise.resolve(`import { FontHead } from "${fontsUrl}"; export default FontHead;`);
      }
      if (sourceFile.endsWith("src/react/fonts/index.ts")) {
        return Promise.resolve(
          'import { InternalHead } from "../components/Head.js"; export const FontHead = InternalHead;',
        );
      }
      if (sourceFile.endsWith("src/react/components/Head.tsx")) {
        return Promise.resolve(
          'import React from "https://esm.sh/react@19.2.4?target=es2022&deps=csstype@3.2.3"; export function InternalHead() { return React.createElement("title"); }',
        );
      }
      return Promise.resolve("export const value = true;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const reactHash = manifest.dependencies.react?.contentHash;
    const fontsHash = manifest.dependencies["veryfront/fonts"]?.contentHash;
    const pageHash = manifest.modules["pages/fonts.mdx"]?.contentHash;
    assertExists(reactHash);
    assertExists(fontsHash);
    assertExists(pageHash);

    const fontsUpload = rec.uploads.find((u) => u.hash === fontsHash);
    assertExists(fontsUpload);
    assert(!fontsUpload.text.includes("../components/Head"));
    const internalHeadMatch = fontsUpload.text.match(/"\/_vf\/assets\/([a-f0-9]{64})\.js"/);
    assertExists(internalHeadMatch?.[1]);

    const internalHeadUpload = rec.uploads.find((u) => u.hash === internalHeadMatch[1]);
    assertExists(internalHeadUpload);
    assert(internalHeadUpload.text.includes(`"/_vf/assets/${reactHash}.js"`));
    assertEquals(await hasEsmShReactImport(internalHeadUpload.text), false);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${fontsHash}.js"`));
    assert(!pageUpload.text.includes(fontsUrl));
  });

  it("matches React import-map dependencies by normalized HTTP manifest key", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);

    const result = await runReleaseAssetBuild(
      {
        ...baseInput(client, transform),
        vendorHttpImports: fakeNormalizedVendorHttpImports,
      },
      await tmp(),
    );

    assertEquals(result.success, true);

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.dependencies.react);
    assertExists(manifest.dependencies["react-dom/client"]);
    assertExists(manifest.dependencies["react/jsx-runtime"]);
  });

  it("fails closed when React import-map dependencies cannot be vendored", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    const transform = (source: string) => Promise.resolve(source);
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: (code: string) => Promise.resolve({ code, dependencies: [] }),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "dependency-vendor-failed:react-import-map");
  });

  it("rewrites covered project module imports to immutable asset URLs", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import Header from "../components/Header.tsx"; export default Header;',
      },
      {
        path: "components/Header.tsx",
        content: "export default function Header() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Header from "/_vf_modules/components/Header.js"; export default Header;',
        );
      }
      return Promise.resolve("export default function Header() { return null; }");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const headerHash = manifest.modules["components/Header.tsx"]?.contentHash;
    assertExists(headerHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${headerHash}.js"`));
    assert(!pageUpload.text.includes("/_vf_modules/components/Header.js"));
  });

  it("vendors transformed HTTP imports into immutable dependency assets", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import motion from "framer-motion"; export default motion;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import motion from "https://esm.sh/framer-motion@11"; export default motion;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/framer-motion@11",
            "file:///tmp/veryfront-http-bundle/http-123.mjs",
          ),
          dependencies: [{
            specifier: "file:///tmp/veryfront-http-bundle/http-123.mjs",
            manifestKey: "https://esm.sh/framer-motion@11",
            code: "export default function motion() {}",
          }],
        })
      ),
    };

    await runReleaseAssetBuild(input, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const dependencyHash = manifest.dependencies["https://esm.sh/framer-motion@11"]?.contentHash;
    assertExists(dependencyHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const dependencyUpload = rec.uploads.find((u) => u.hash === dependencyHash);
    assertExists(dependencyUpload);
    assertEquals(dependencyUpload.text, "export default function motion() {}");

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assertEquals(await moduleSpecifiers(pageUpload.text), [
      `/_vf/assets/${dependencyHash}.js`,
    ]);
  });

  it("keeps final import validation when reusing the dependency materializer", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'import legacy from "legacy-package"; export default legacy;',
    }];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import legacy from "https://esm.sh/legacy-package@1"; export default legacy;',
      );
    const legacyCode = [
      "export const load = (path) => import(path);",
      'export const asset = new URL("./worker.wasm", import.meta.url);',
      "//# sourceMappingURL=legacy-package.js.map",
    ].join("\n");
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/legacy-package@1",
            "file:///virtual/veryfront-http-bundle/http-legacy.mjs",
          ),
          dependencies: [{
            specifier: "file:///virtual/veryfront-http-bundle/http-legacy.mjs",
            manifestKey: "https://esm.sh/legacy-package@1",
            code: legacyCode,
          }],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "dependency-finalize-failed");
  });

  it("rewrites nested vendored HTTP dependency imports to immutable assets", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
              manifestKey: "https://esm.sh/parent@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
              code: 'import child from "./http-bbb.mjs"; export default child;',
            },
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-bbb.mjs",
              manifestKey: "https://esm.sh/child@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-bbb.mjs",
              code: "export default function child() {}",
            },
          ],
        })
      ),
    };

    await runReleaseAssetBuild(input, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const parentHash = manifest.dependencies["https://esm.sh/parent@1"]?.contentHash;
    const childHash = manifest.dependencies["https://esm.sh/child@1"]?.contentHash;
    assertExists(parentHash);
    assertExists(childHash);

    const parentUpload = rec.uploads.find((u) => u.hash === parentHash);
    assertExists(parentUpload);
    assert(parentUpload.text.includes(`"/_vf/assets/${childHash}.js"`));
    assert(!parentUpload.text.includes("./http-bbb.mjs"));
  });

  it("resolves vendored dependency relatives from their source file path", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import a from "remote-a"; import b from "remote-b"; export default [a, b];',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import a from "https://esm.sh/a@1"; import b from "https://esm.sh/b@1"; export default [a, b];',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code
            .replace("https://esm.sh/a@1", "file:///tmp/vf-http/a/parent.mjs")
            .replace("https://esm.sh/b@1", "file:///tmp/vf-http/b/parent.mjs"),
          dependencies: [
            {
              specifier: "file:///tmp/vf-http/a/parent.mjs",
              manifestKey: "https://esm.sh/a@1",
              sourcePath: "/tmp/vf-http/a/parent.mjs",
              code: 'import shared from "./shared.mjs"; export default shared;',
            },
            {
              specifier: "file:///tmp/vf-http/a/shared.mjs",
              manifestKey: "https://esm.sh/a-shared@1",
              sourcePath: "/tmp/vf-http/a/shared.mjs",
              code: 'export default "a";',
            },
            {
              specifier: "file:///tmp/vf-http/b/parent.mjs",
              manifestKey: "https://esm.sh/b@1",
              sourcePath: "/tmp/vf-http/b/parent.mjs",
              code: 'import shared from "./shared.mjs"; export default shared;',
            },
            {
              specifier: "file:///tmp/vf-http/b/shared.mjs",
              manifestKey: "https://esm.sh/b-shared@1",
              sourcePath: "/tmp/vf-http/b/shared.mjs",
              code: 'export default "b";',
            },
          ],
        })
      ),
    };

    await runReleaseAssetBuild(input, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const aParentHash = manifest.dependencies["https://esm.sh/a@1"]?.contentHash;
    const aSharedHash = manifest.dependencies["https://esm.sh/a-shared@1"]?.contentHash;
    const bParentHash = manifest.dependencies["https://esm.sh/b@1"]?.contentHash;
    const bSharedHash = manifest.dependencies["https://esm.sh/b-shared@1"]?.contentHash;
    assertExists(aParentHash);
    assertExists(aSharedHash);
    assertExists(bParentHash);
    assertExists(bSharedHash);

    const aParentUpload = rec.uploads.find((u) => u.hash === aParentHash);
    const bParentUpload = rec.uploads.find((u) => u.hash === bParentHash);
    assertExists(aParentUpload);
    assertExists(bParentUpload);
    assert(aParentUpload.text.includes(`"/_vf/assets/${aSharedHash}.js"`));
    assert(!aParentUpload.text.includes(`"/_vf/assets/${bSharedHash}.js"`));
    assert(bParentUpload.text.includes(`"/_vf/assets/${bSharedHash}.js"`));
    assert(!bParentUpload.text.includes(`"/_vf/assets/${aSharedHash}.js"`));
  });

  it("fails closed when vendored dependency assets contain a cycle", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
              manifestKey: "https://esm.sh/parent@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
              code: 'import child from "./http-bbb.mjs"; export default child;',
            },
            {
              specifier: "file:///tmp/veryfront-http-bundle/http-bbb.mjs",
              manifestKey: "https://esm.sh/child@1",
              sourcePath: "/tmp/veryfront-http-bundle/http-bbb.mjs",
              code: 'import parent from "./http-aaa.mjs"; export default parent;',
            },
          ],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "dependency-cycle:");
  });

  it("fails closed when a vendored dependency keeps an unresolved file import", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [{
            specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
            manifestKey: "https://esm.sh/parent@1",
            sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
            code: 'import secret from "file:///tmp/outside-secret.mjs"; export default secret;',
          }],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "dependency-finalize-failed");
  });

  it("fails closed when a vendored dependency asset exceeds the size limit", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import parent from "remote-parent"; export default parent;',
      },
    ];
    const client = makeClient(files, rec);
    const transform = () =>
      Promise.resolve(
        'import parent from "https://esm.sh/parent@1"; export default parent;',
      );
    const input = {
      ...baseInput(client, transform),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(
            "https://esm.sh/parent@1",
            "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
          ),
          dependencies: [{
            specifier: "file:///tmp/veryfront-http-bundle/http-aaa.mjs",
            manifestKey: "https://esm.sh/parent@1",
            sourcePath: "/tmp/veryfront-http-bundle/http-aaa.mjs",
            code: "x".repeat(RELEASE_ASSET_MAX_SIZE_BYTES + 1),
          }],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "module-dependency-vendor-failed:pages/index.tsx");
  });

  it("rewrites transformed relative project imports to immutable asset URLs", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import Hero from "../components/sections/HeroSection.tsx"; export default Hero;',
      },
      {
        path: "components/sections/HeroSection.tsx",
        content: 'import Button from "../elements/Button.tsx"; export default Button;',
      },
      {
        path: "components/elements/Button.tsx",
        content: "export default function Button() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Hero from "/_vf_modules/components/sections/HeroSection.js"; export default Hero;',
        );
      }
      if (sourceFile.endsWith("components/sections/HeroSection.tsx")) {
        return Promise.resolve(
          'import Button from "../../components/elements/Button.js"; export default Button;',
        );
      }
      return Promise.resolve("export default function Button() { return null; }");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const buttonHash = manifest.modules["components/elements/Button.tsx"]?.contentHash;
    assertExists(buttonHash);
    const heroHash = manifest.modules["components/sections/HeroSection.tsx"]?.contentHash;
    assertExists(heroHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const heroUpload = rec.uploads.find((u) => u.hash === heroHash);
    assertExists(heroUpload);
    assert(heroUpload.text.includes(`"/_vf/assets/${buttonHash}.js"`));
    assert(!heroUpload.text.includes("../../components/elements/Button.js"));

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${heroHash}.js"`));
    assert(!pageUpload.text.includes("/_vf_modules/components/sections/HeroSection.js"));
  });

  it("rewrites transformed root project imports to immutable asset URLs", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: 'import Button from "../components/Button.tsx";' },
      { path: "components/Button.tsx", content: "export const Button = () => null;" },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve('import { Button } from "/components/Button.js"; Button();');
      }
      return Promise.resolve("export const Button = () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const buttonHash = manifest.modules["components/Button.tsx"]?.contentHash;
    assertExists(buttonHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(pageUpload.text.includes(`"/_vf/assets/${buttonHash}.js"`));
    assert(!pageUpload.text.includes("/components/Button.js"));
  });

  it("rewrites browser-reachable imports from arbitrary project folders", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import Header from "../components/Header.tsx"; export default Header;',
      },
      {
        path: "components/Header.tsx",
        content: 'import { BreakpointsProvider } from "../custom-client/BreakpointsProvider.tsx";',
      },
      {
        path: "custom-client/BreakpointsProvider.tsx",
        content: "export const BreakpointsProvider = ({ children }) => children;",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Header from "/_vf_modules/components/Header.js"; export default Header;',
        );
      }
      if (sourceFile.endsWith("components/Header.tsx")) {
        return Promise.resolve(
          'import { BreakpointsProvider } from "../custom-client/BreakpointsProvider.js"; export { BreakpointsProvider };',
        );
      }
      return Promise.resolve("export const BreakpointsProvider = ({ children }) => children;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const providerHash = manifest.modules["custom-client/BreakpointsProvider.tsx"]?.contentHash;
    assertExists(providerHash);
    const headerHash = manifest.modules["components/Header.tsx"]?.contentHash;
    assertExists(headerHash);

    const headerUpload = rec.uploads.find((u) => u.hash === headerHash);
    assertExists(headerUpload);
    assert(headerUpload.text.includes(`"/_vf/assets/${providerHash}.js"`));
    assert(!headerUpload.text.includes("../custom-client/BreakpointsProvider.js"));

    const routeModules = manifest.routes["/"]?.modules ?? [];
    assert(routeModules.includes("custom-client/BreakpointsProvider.tsx"));
  });

  it("does not preload type-only imports from arbitrary project folders", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: [
          'import Header from "../components/Header.tsx";',
          'import type { BreakpointName } from "../providers/BreakpointsProvider.ts";',
          "export default Header;",
        ].join("\n"),
      },
      {
        path: "components/Header.tsx",
        content: "export default function Header() { return null; }",
      },
      {
        path: "providers/BreakpointsProvider.ts",
        content: "export type BreakpointName = 'mobile' | 'desktop';",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Header from "/_vf_modules/components/Header.js"; export default Header;',
        );
      }
      return Promise.resolve("export default function Header() { return null; }");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(result.coverageFailures, []);
    assertEquals(manifest.modules["providers/BreakpointsProvider.ts"], undefined);
    assertEquals(manifest.routes["/"]?.modules.includes("providers/BreakpointsProvider.ts"), false);
  });

  it("does not preload inline type-only import or export specifiers", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: [
          'import Header from "../components/Header.tsx";',
          'import { type BreakpointName } from "../providers/BreakpointsProvider.ts";',
          'export { type BreakpointToken } from "../providers/BreakpointTokens.ts";',
          "export default Header;",
        ].join("\n"),
      },
      {
        path: "components/Header.tsx",
        content: "export default function Header() { return null; }",
      },
      {
        path: "providers/BreakpointsProvider.ts",
        content: "export type BreakpointName = 'mobile' | 'desktop';",
      },
      {
        path: "providers/BreakpointTokens.ts",
        content: "export type BreakpointToken = 'sm' | 'lg';",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          'import Header from "/_vf_modules/components/Header.js"; export default Header;',
        );
      }
      return Promise.resolve("export default function Header() { return null; }");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(result.coverageFailures, []);
    assertEquals(manifest.modules["providers/BreakpointsProvider.ts"], undefined);
    assertEquals(manifest.modules["providers/BreakpointTokens.ts"], undefined);
  });

  it("builds route closure from transformed modules when raw page source is not JavaScript", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/blog.mdx",
        content: '+++\ntitle = "Blog"\n+++\n\n<Hero />',
      },
      {
        path: "components/Hero.tsx",
        content: "export default function Hero() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/blog.mdx")) {
        return Promise.resolve(
          'import Hero from "/_vf_modules/components/Hero.js"; export default Hero;',
        );
      }
      return Promise.resolve("export default function Hero() { return null; }");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true);
    assertEquals(result.state, "ready");
    assertEquals(rec.states, []);

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.modules["pages/blog.mdx"]);
    assertExists(manifest.modules["components/Hero.tsx"]);
    const routeModules = manifest.routes["/blog"]?.modules ?? [];
    assert(routeModules.includes("pages/blog.mdx"));
    assert(routeModules.includes("components/Hero.tsx"));
    assertEquals(result.coverageFailures, []);
  });

  it("does not rewrite import-like strings or comments in transformed modules", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/index.tsx", content: "export default function Page() { return null; }" },
      { path: "components/Button.tsx", content: "export const Button = () => null;" },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve([
          "const sample = 'import { Button } from \"/components/Button.js\"';",
          '// import { Button } from "/components/Button.js"',
          "export default function Page() { return sample; }",
        ].join("\n"));
      }
      return Promise.resolve("export const Button = () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const buttonHash = manifest.modules["components/Button.tsx"]?.contentHash;
    assertExists(buttonHash);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(
      pageUpload.text.includes(
        "const sample = 'import { Button } from \"/components/Button.js\"';",
      ),
    );
    assert(pageUpload.text.includes('// import { Button } from "/components/Button.js"'));
    assert(!pageUpload.text.includes(`/_vf/assets/${buttonHash}.js`));
  });

  it("rewrites framework module imports to immutable release assets", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import { useWorkflow } from "veryfront/workflow"; export default useWorkflow;',
      },
    ];
    const client = makeClient(files, rec);
    const frameworkUrl = "/_vf_modules/_veryfront/workflow/react/index.js";
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          `import { useWorkflow } from "${frameworkUrl}"; export default useWorkflow;`,
        );
      }
      return Promise.resolve("export const useWorkflow = () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertExists(manifest.dependencies["veryfront/workflow"]);
    const pageHash = manifest.modules["pages/index.tsx"]?.contentHash;
    assertExists(pageHash);

    const pageUpload = rec.uploads.find((u) => u.hash === pageHash);
    assertExists(pageUpload);
    assert(!pageUpload.text.includes(`"${frameworkUrl}"`));
    assert(
      pageUpload.text.includes(
        `"/_vf/assets/${manifest.dependencies["veryfront/workflow"]?.contentHash}.js"`,
      ),
    );
  });

  it("publishes package-root published runtime helper imports as release assets", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import { useWorkflow } from "veryfront/workflow"; export default useWorkflow;',
      },
    ];
    const client = makeClient(files, rec);
    const frameworkUrl = "/_vf_modules/_veryfront/workflow/react/index.js";
    const consumerUrl = "/_vf_modules/_veryfront/published-helper-consumer.js";

    // Emulate a published package layout: a framework module in the temp
    // lookup dir importing the DNT runtime helper at the package root.
    const tempDir = await tmp();
    await Deno.mkdir(join(tempDir, "src"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "src", "published-helper-consumer.ts"),
      'import "../deno.js";\nexport const consumer = true;\n',
    );
    await Deno.writeTextFile(join(tempDir, "deno.js"), "export {};\n");

    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          `import { useWorkflow } from "${frameworkUrl}"; export default useWorkflow;`,
        );
      }
      if (sourceFile.endsWith("src/workflow/react/index.ts")) {
        return Promise.resolve(
          `import { consumer } from "${consumerUrl}"; export const useWorkflow = () => consumer;`,
        );
      }
      if (sourceFile.endsWith("published-helper-consumer.ts")) {
        return Promise.resolve('import "../deno.js"; export const consumer = true;');
      }
      return Promise.resolve("export const value = true;");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), tempDir);

    assertEquals(result.success, true);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const workflowHash = manifest.dependencies["veryfront/workflow"]?.contentHash;
    assertExists(workflowHash);

    const workflowUpload = rec.uploads.find((u) => u.hash === workflowHash);
    assertExists(workflowUpload);
    const consumerMatch = workflowUpload.text.match(/"\/_vf\/assets\/([a-f0-9]{64})\.js"/);
    assertExists(consumerMatch?.[1]);

    const consumerUpload = rec.uploads.find((u) => u.hash === consumerMatch[1]);
    assertExists(consumerUpload);
    assert(!consumerUpload.text.includes("../deno.js"));
    const helperMatch = consumerUpload.text.match(/"\/_vf\/assets\/([a-f0-9]{64})\.js"/);
    assertExists(helperMatch?.[1]);
    assertExists(rec.uploads.find((u) => u.hash === helperMatch[1]));
  });

  it("keeps same-named published runtime helpers from different roots distinct", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "pages/index.tsx",
        content: 'import { useWorkflow } from "veryfront/workflow"; export default useWorkflow;',
      },
    ];
    const client = makeClient(files, rec);
    const frameworkUrl = "/_vf_modules/_veryfront/workflow/react/index.js";
    const consumerAUrl = "/_vf_modules/_veryfront/published-helper-consumer.js";
    const consumerBUrl = "/_vf_modules/_veryfront/nested/src/consumer.js";

    // Two package roots (tempDir and tempDir/src/nested), each with its own
    // deno.js helper carrying different contents.
    const tempDir = await tmp();
    await Deno.mkdir(join(tempDir, "src", "nested", "src"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "src", "published-helper-consumer.ts"),
      'import "../deno.js";\nexport const consumerA = true;\n',
    );
    await Deno.writeTextFile(join(tempDir, "deno.js"), 'export const helperA = "a";\n');
    await Deno.writeTextFile(
      join(tempDir, "src", "nested", "src", "consumer.ts"),
      'import "../deno.js";\nexport const consumerB = true;\n',
    );
    await Deno.writeTextFile(
      join(tempDir, "src", "nested", "deno.js"),
      'export const helperB = "b";\n',
    );

    const transform = (source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/index.tsx")) {
        return Promise.resolve(
          `import { useWorkflow } from "${frameworkUrl}"; export default useWorkflow;`,
        );
      }
      if (sourceFile.endsWith("src/workflow/react/index.ts")) {
        return Promise.resolve(
          `import { consumerA } from "${consumerAUrl}"; import { consumerB } from "${consumerBUrl}"; export const useWorkflow = () => consumerA && consumerB;`,
        );
      }
      if (
        sourceFile.endsWith("published-helper-consumer.ts") ||
        sourceFile.endsWith("nested/src/consumer.ts") ||
        sourceFile.endsWith("deno.js")
      ) {
        return Promise.resolve(source);
      }
      return Promise.resolve("export const value = true;");
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), tempDir);

    assertEquals(result.success, true);
    const consumerAUpload = rec.uploads.find((u) => u.text.includes("consumerA = true"));
    const consumerBUpload = rec.uploads.find((u) => u.text.includes("consumerB = true"));
    assertExists(consumerAUpload);
    assertExists(consumerBUpload);

    const helperAHash = consumerAUpload.text.match(/"\/_vf\/assets\/([a-f0-9]{64})\.js"/)?.[1];
    const helperBHash = consumerBUpload.text.match(/"\/_vf\/assets\/([a-f0-9]{64})\.js"/)?.[1];
    assertExists(helperAHash);
    assertExists(helperBHash);
    assert(helperAHash !== helperBHash);

    const helperAUpload = rec.uploads.find((u) => u.hash === helperAHash);
    const helperBUpload = rec.uploads.find((u) => u.hash === helperBHash);
    assertExists(helperAUpload);
    assertExists(helperBUpload);
    assert(helperAUpload.text.includes("helperA"));
    assert(helperBUpload.text.includes("helperB"));
  });

  it("fails closed on cyclic project imports", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "pages/a.tsx", content: 'import B from "../components/B.tsx"; export default B;' },
      { path: "components/B.tsx", content: 'import A from "../pages/a.tsx"; export default A;' },
    ];
    const client = makeClient(files, rec);
    const transform = (_source: string, sourceFile: string) => {
      if (sourceFile.endsWith("pages/a.tsx")) {
        return Promise.resolve('import B from "/_vf_modules/components/B.js"; export default B;');
      }
      return Promise.resolve('import A from "/_vf_modules/pages/a.js"; export default A;');
    };

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertCoverageFailure(result, rec, "cycle:pages/a.tsx->components/B.tsx->pages/a.tsx");
  });

  it("fails closed when a project module transform fails", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "boom" }];
    const client = makeClient(files, rec);
    const transform = () => Promise.reject(new Error("bad syntax in /secret/path.tsx"));

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertCoverageFailure(result, rec, "module-transform-failed:pages/index.tsx");
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
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    const moduleHashes = new Set(Object.values(manifest.modules).map((entry) => entry.contentHash));
    assertEquals(rec.uploads.filter((upload) => moduleHashes.has(upload.hash)).length, 1);
  });

  it("includes compiled CSS when a css pipeline is provided", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'export default () => "<div class=\\"p-4\\"/>";',
    }];
    const client = makeClient(files, rec, {
      compileProjectCss: () => Promise.resolve(compiledCss(".p-4{padding:1rem}")),
    });
    const transform = () => Promise.resolve("export default null;");

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.cssCount, 1);
    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);
    assertEquals(manifest.css[0]?.styleProfileHash, STYLE_PROFILE_HASH);
    assertEquals(manifest.css[0]?.cssPipelineIdentity, CSS_PIPELINE_IDENTITY);
    assertEquals(manifest.css[0]?.contentType, "text/css");
    // The route entry must carry the compiled CSS hash (project-level CSS is
    // applied to every route per the executor contract).
    const cssHash = manifest.css[0]?.contentHash;
    assertExists(cssHash);
    assertEquals(manifest.routes["/"]?.css, [cssHash]);
  });

  it("fails the release when requested CSS compilation returns null", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{
      path: "pages/index.tsx",
      content: 'export default () => "<div class=\\"p-4\\"/>";',
    }];
    const client = makeClient(files, rec, {
      compileProjectCss: () => Promise.resolve(null),
    });
    const transform = () => Promise.resolve("export default null;");

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.at(-1)?.state, "failed");
    assertStringIncludes(result.error ?? "", "returned no requested output");
  });

  it("fails the release when compiled CSS identity metadata is invalid", async () => {
    const files = [{
      path: "pages/index.tsx",
      content: 'export default () => "<div class=\\"p-4\\"/>";',
    }];
    const invalidResults: Array<{ label: string; result: unknown }> = [
      {
        label: "noncanonical profile hash",
        result: compiledCss(".p-4{}", "profile-1"),
      },
      {
        label: "missing pipeline identity",
        result: { css: ".p-4{}", styleProfileHash: STYLE_PROFILE_HASH },
      },
      {
        label: "noncanonical pipeline identity",
        result: compiledCss(".p-4{}", STYLE_PROFILE_HASH, " pipeline\nidentity "),
      },
      {
        label: "empty output",
        result: compiledCss(""),
      },
    ];

    for (const invalid of invalidResults) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient(files, rec, {
        compileProjectCss: () => Promise.resolve(invalid.result as CompileProjectCssResult),
      });

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, false, invalid.label);
      assertEquals(result.state, "failed", invalid.label);
      assertEquals(rec.manifest, null, invalid.label);
      assertEquals(rec.states.at(-1)?.state, "failed", invalid.label);
      assertStringIncludes(result.error ?? "", "invalid identity result");
    }
  });

  it("does not execute accessors on a forged CSS compiler result", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let getterCalls = 0;
    const forgedResult = {
      get css(): string {
        getterCalls++;
        throw new Error("must not execute");
      },
      styleProfileHash: STYLE_PROFILE_HASH,
      cssPipelineIdentity: CSS_PIPELINE_IDENTITY,
    };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        compileProjectCss: () => Promise.resolve(forgedResult as CompileProjectCssResult),
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(getterCalls, 0);
    assertEquals(rec.manifest, null);
    assertStringIncludes(result.error ?? "", "invalid identity result");
  });

  it("passes the resolved stylesheet to compileProjectCss", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; } /* custom */" },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"p-4\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined = "UNSET";
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".p-4{padding:1rem}"));
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(seenStylesheet, ":root { --brand: blue; } /* custom */");
  });

  it("passes the exact materialized config source to the trusted config loader", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: `import { defineConfig } from "veryfront";
export default defineConfig({ tailwind: { stylesheet: "src/styles/app.css" } });`,
      },
      { path: "globals.css", content: "/* fallback stylesheet that should not be used */" },
      { path: "src/styles/app.css", content: ":root { --brand: blue; } /* release-config */" },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"p-4\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined;
    let seenConfig: VeryfrontConfig | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet, options) => {
        seenStylesheet = stylesheet;
        seenConfig = options?.config;
        return Promise.resolve(compiledCss(".p-4{padding:1rem}"));
      },
    });
    const transform = (s: string) => Promise.resolve(s);
    let selectedConfigSource: Parameters<ReleaseAssetBuildInput["loadConfig"]>[0] | undefined;

    await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: (source) => {
        selectedConfigSource = source;
        return Promise.resolve({
          tailwind: { stylesheet: "src/styles/app.css" },
        } as VeryfrontConfig);
      },
    }, await tmp());

    assertEquals(seenStylesheet, ":root { --brand: blue; } /* release-config */");
    assertEquals(seenConfig?.tailwind?.stylesheet, "src/styles/app.css");
    assertEquals(selectedConfigSource, {
      fileName: "veryfront.config.ts",
      source: files[0]!.content,
    });
  });

  it("uses only the config returned for the immutable release source", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: `import { defineConfig } from "veryfront";
export default defineConfig({ tailwind: { stylesheet: "src/styles/release.css" } });`,
      },
      { path: "src/styles/stale.css", content: "/* stale request-context config */" },
      {
        path: "src/styles/release.css",
        content: ":root { --brand: blue; } /* release config wins */",
      },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"p-4\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".p-4{padding:1rem}"));
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: releaseConfigLoader({
        tailwind: { stylesheet: "src/styles/release.css" },
      }),
    }, await tmp());

    assertEquals(seenStylesheet, ":root { --brand: blue; } /* release config wins */");
  });

  it("fails closed when the configured release stylesheet is missing", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let compileCalls = 0;
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default () => null;" }],
      rec,
      {
        compileProjectCss: () => {
          compileCalls++;
          return Promise.resolve(compiledCss(".unexpected{}"));
        },
      },
    );

    const result = await runReleaseAssetBuild({
      ...baseInput(client, (source) => Promise.resolve(source)),
      loadConfig: releaseConfigLoader({
        tailwind: { stylesheet: "src/styles/missing.css" },
      }),
    }, await tmp());

    assertCoverageFailure(result, rec, "stylesheet-missing:src/styles/missing.css");
    assertEquals(compileCalls, 0);
  });

  it("never executes materialized config source in the build host", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: `throw new Error("tenant config executed in build host");
export default { tailwind: { stylesheet: "src/styles/imported.css" } };`,
      },
      { path: "globals.css", content: "/* fallback stylesheet that should not be used */" },
      {
        path: "src/styles/imported.css",
        content: ":root { --brand: blue; } /* imported release config */",
      },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"p-4\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined;
    let seenConfig: VeryfrontConfig | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet, options) => {
        seenStylesheet = stylesheet;
        seenConfig = options?.config;
        return Promise.resolve(compiledCss(".p-4{padding:1rem}"));
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: releaseConfigLoader({
        tailwind: { stylesheet: "src/styles/imported.css" },
      }),
    }, await tmp());

    assertEquals(result.success, true);
    assertEquals(seenStylesheet, ":root { --brand: blue; } /* imported release config */");
    assertEquals(seenConfig?.tailwind?.stylesheet, "src/styles/imported.css");
  });

  it("fails closed when the trusted config loader rejects release config", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: `import { defineConfig } from "veryfront";
export default defineConfig({ tailwind: { stylesheet: "globals.css" }, typoKey: true });`,
      },
      { path: "globals.css", content: ":root { --brand: blue; }" },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);
    const transform = (s: string) => Promise.resolve(s);

    const result = await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: () => Promise.reject(new Error("release config rejected")),
    }, await tmp());

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertStringIncludes(
      result.error ?? "",
      "release config rejected",
    );
    assertEquals(rec.states.length, 1);
    assertEquals(rec.states[0]?.state, "failed");
    assertStringIncludes(
      rec.states[0]?.error ?? "",
      "release config rejected",
    );
  });

  it("uses the validated helper result returned by the config boundary", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: `import { defineConfigWithEnv, getEnv, mergeConfigs } from "veryfront";
const shared = { tailwind: { stylesheet: getEnv("VERYFRONT_RELEASE_CONFIG_STYLESHEET") } };
export default defineConfigWithEnv((env) =>
  mergeConfigs(shared, { react: { version: env === "production" ? "19.2.8" : "19.2.9" } })
);`,
      },
      {
        path: "src/styles/helper.css",
        content: ":root { --brand: blue; } /* helper config */",
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    let seenStylesheet: string | undefined;
    const seenReactVersions: Array<string | undefined> = [];
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".helper{}"));
      },
    });
    const transform: ReleaseAssetBuildInput["transform"] = (
      _source,
      _sourceFile,
      _projectDir,
      _adapter,
      options,
    ) => {
      seenReactVersions.push(options.reactVersion);
      return Promise.resolve("export default () => null;");
    };

    await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: releaseConfigLoader({
        tailwind: { stylesheet: "src/styles/helper.css" },
        react: { version: "19.2.8" },
      }),
    }, await tmp());

    assertEquals(seenStylesheet, ":root { --brand: blue; } /* helper config */");
    assert(seenReactVersions.length > 0);
    assert(seenReactVersions.every((version) => version === "19.2.8"));
  });

  it("uses the source-bound React version for module transforms", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: `import { defineConfig } from "veryfront";
export default defineConfig({ react: { version: "19.2.1" } });`,
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);
    const seenReactVersions: Array<string | undefined> = [];
    const transform: ReleaseAssetBuildInput["transform"] = (
      _source,
      _sourceFile,
      _projectDir,
      _adapter,
      options,
    ) => {
      seenReactVersions.push(options.reactVersion);
      return Promise.resolve("export default () => null;");
    };

    await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: releaseConfigLoader({ react: { version: "19.2.1" } }),
    }, await tmp());

    assert(seenReactVersions.length > 0);
    assert(seenReactVersions.every((version) => version === "19.2.1"));
  });

  it("loads React version from materialized release package.json", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "package.json",
        content: JSON.stringify({ dependencies: { react: "^19.2.3" } }),
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    const client = makeClient(files, rec);
    const seenReactVersions: Array<string | undefined> = [];
    const transform: ReleaseAssetBuildInput["transform"] = (
      _source,
      _sourceFile,
      _projectDir,
      _adapter,
      options,
    ) => {
      seenReactVersions.push(options.reactVersion);
      return Promise.resolve("export default () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assert(seenReactVersions.length > 0);
    assert(seenReactVersions.every((version) => version === "19.2.3"));
  });

  it("uses one materialized dependency snapshot for every project and framework transform", async () => {
    enableDependencyImportMap();
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();

    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { react: "18.3.1", lodash: "1.0.0" },
        }),
      },
      {
        path: "veryfront.config.ts",
        content: `export default { react: { version: "19.2.1" } };`,
      },
      {
        path: "pages/a.tsx",
        content: 'import "veryfront/head"; export default () => "a";',
      },
      { path: "pages/b.tsx", content: "export default () => 'b';" },
    ];
    const client = makeClient(files, rec);
    const observations: Array<{
      sourceFile: string;
      snapshot: DependencyPinningSnapshot;
      pinningSource: NonNullable<DependencyPinningSourceInput>;
    }> = [];
    let newerSnapshot: DependencyPinningSnapshot | undefined;

    const transform: ReleaseAssetBuildInput["transform"] = async (
      source,
      sourceFile,
      projectDir,
      _adapter,
      options,
    ) => {
      const snapshot = options.dependencyPinningSnapshot;
      const pinningSource = options.dependencyPinningSource;
      assertExists(snapshot);
      assertExists(pinningSource);
      observations.push({ sourceFile, snapshot, pinningSource });

      if (sourceFile.endsWith("pages/a.tsx")) {
        await Deno.writeTextFile(
          join(projectDir, "package.json"),
          JSON.stringify({
            dependencies: { react: "18.3.1", lodash: "2.0.0" },
          }),
        );
        const future = new Date(Date.now() + 2_000);
        await Deno.utime(join(projectDir, "package.json"), future, future);
        newerSnapshot = await resolveDependencyPinningSnapshot(pinningSource);
      }

      return sourceFile.includes("/pages/") ? source : "export const framework = true;";
    };

    const result = await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: releaseConfigLoader({ react: { version: "19.2.1" } }),
    }, await tmp());

    assertEquals(result.success, true);
    assert(observations.some(({ sourceFile }) => sourceFile.endsWith("pages/a.tsx")));
    assert(observations.some(({ sourceFile }) => sourceFile.endsWith("pages/b.tsx")));
    assert(observations.some(({ sourceFile }) => !sourceFile.includes("/pages/")));

    const buildSnapshot = observations[0]?.snapshot;
    const buildSource = observations[0]?.pinningSource;
    assertExists(buildSnapshot);
    assertExists(buildSource);
    assertEquals(buildSnapshot.cacheKey.startsWith("on:"), true);
    assertEquals(buildSnapshot.dependencies?.react, "19.2.1");
    assertEquals(buildSnapshot.dependencies?.lodash, "1.0.0");
    assertEquals(
      observations.every(
        ({ snapshot, pinningSource }) =>
          snapshot === buildSnapshot && pinningSource === buildSource,
      ),
      true,
    );
    assertExists(newerSnapshot);
    assertEquals(newerSnapshot.dependencies?.lodash, "2.0.0");
    assertEquals(newerSnapshot.cacheKey === buildSnapshot.cacheKey, false);
  });

  it("uses conventional stylesheet and default React version when config is absent", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; } /* fallback */" },
      { path: "pages/index.tsx", content: 'export default () => "<div class=\\"p-4\\"/>";' },
    ];
    let seenStylesheet: string | undefined;
    const seenReactVersions: Array<string | undefined> = [];
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".p-4{padding:1rem}"));
      },
    });
    const transform: ReleaseAssetBuildInput["transform"] = (
      _source,
      _sourceFile,
      _projectDir,
      _adapter,
      options,
    ) => {
      seenReactVersions.push(options.reactVersion);
      return Promise.resolve("export default () => null;");
    };

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(seenStylesheet, ":root { --brand: blue; } /* fallback */");
    assert(seenReactVersions.length > 0);
    assert(seenReactVersions.every((version) => version === "19.2.4"));
  });

  it("merges module-imported CSS into the stylesheet passed to compileProjectCss", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; }" },
      { path: "app/styles.css", content: ".calc { background: #191919; }" },
      {
        path: "app/layout.tsx",
        content: 'import "./styles.css";\nexport default ({ children }) => children;',
      },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"calc\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".calc{background:#191919}"));
      },
    });
    const transform = () => Promise.resolve("export default null;");

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertExists(seenStylesheet);
    assert(
      seenStylesheet!.includes(":root { --brand: blue; }"),
      "resolved stylesheet must be preserved",
    );
    assert(
      seenStylesheet!.includes(".calc"),
      "CSS imported from app/layout.tsx must be merged into the stylesheet",
    );
  });

  it("rejects a CSS import scan that would omit a later live stylesheet", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const externalImports = Array.from(
      { length: 50_000 },
      () => 'import {} from "x.css";',
    ).join("\n");
    const files = [
      { path: "app/live.css", content: ".live { color: green; }" },
      {
        path: "app/layout.tsx",
        content:
          `${externalImports}\nimport {} from "./live.css";\nexport default ({ children }) => children;`,
      },
    ];

    const result = await runReleaseAssetBuild(
      baseInput(makeClient(files, rec), () => Promise.resolve("export default null;")),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertStringIncludes(
      result.error ?? "",
      "Release CSS import scan exceeds 50000 matches",
    );
  });

  it("merges module CSS imported with a query or fragment suffix", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "app/styles.css", content: ".suffixed { color: rebeccapurple; }" },
      {
        path: "app/layout.tsx",
        content: 'import "./styles.css#release"; export default ({ children }) => children;',
      },
      { path: "pages/index.tsx", content: "export default () => null;" },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".suffixed{color:rebeccapurple}"));
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, true, result.error);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet, ".suffixed { color: rebeccapurple; }");
  });

  it("merges module CSS from sources containing real JSX", async () => {
    // Regression: the CSS import scan fed project source to es-module-lexer,
    // which parses neither JSX nor TypeScript. Every .tsx file with a tag threw,
    // each throw recorded a coverage gap, and gaps are fatal, so no project with
    // a JSX component could publish a release.
    //
    // The suite missed it because every fixture put plain JavaScript inside
    // .tsx files. These bodies are the shapes that actually broke in production:
    // a closing component tag, a self-closing tag, and a nested element.
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; }" },
      { path: "app/styles.css", content: ".calc { background: #191919; }" },
      {
        path: "app/layout.tsx",
        content: 'import "./styles.css";\n' +
          "export default ({ children }) => (\n" +
          "  <html><head><title>Assistant</title></head><body>{children}</body></html>\n" +
          ");",
      },
      {
        path: "app/markdown-renderer.tsx",
        content: 'import ReactMarkdown from "react-markdown";\n' +
          "export const R = ({ source }) => <ReactMarkdown>{source}</ReactMarkdown>;",
      },
      {
        path: "pages/index.tsx",
        content: 'import { Chat } from "veryfront/chat";\n' +
          "export default () => <Provider><Chat /></Provider>;",
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".calc{background:#191919}"));
      },
    });
    const transform = () => Promise.resolve("export default null;");

    // The build completing at all is the assertion that matters: a parse gap
    // here aborts it with "Release asset coverage is incomplete".
    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertExists(seenStylesheet);
    assert(
      seenStylesheet!.includes(".calc"),
      "CSS imported from a JSX-bearing layout must still be merged",
    );
  });

  it("does not duplicate the resolved stylesheet when a module imports it directly", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; } /* custom */" },
      {
        path: "app/layout.tsx",
        content: 'import "../globals.css";\nexport default ({ children }) => children;',
      },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div class=\\"p-4\\"/>";',
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss(".p-4{padding:1rem}"));
      },
    });
    const transform = () => Promise.resolve("export default null;");

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertExists(seenStylesheet);
    assertEquals(seenStylesheet!.split("/* custom */").length - 1, 1);
  });

  it("merges CSS Modules with the same scoped classes used by transformed code", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      { path: "globals.css", content: ":root { --brand: blue; }" },
      { path: "components/button.module.css", content: ".button { color: red; }" },
      {
        path: "components/Button.tsx",
        content: 'import styles from "./button.module.css";\nexport const Button = () => null;',
      },
      {
        path: "pages/index.tsx",
        content: 'export default () => "<div/>";',
      },
    ];
    let seenStylesheet: string | undefined;
    const client = makeClient(files, rec, {
      compileProjectCss: (_candidates, stylesheet) => {
        seenStylesheet = stylesheet;
        return Promise.resolve(compiledCss("body{}"));
      },
    });
    const scopedButtonClass = toScopedCssModuleClass(
      "/components/button.module.css",
      "button",
    );
    const transform = (source: string, sourceFile: string) =>
      Promise.resolve(
        sourceFile.endsWith("components/Button.tsx")
          ? `export const buttonClass = ${JSON.stringify(scopedButtonClass)};`
          : source,
      );

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertEquals(result.success, true);
    assertExists(seenStylesheet);
    assertStringIncludes(seenStylesheet!, `.${scopedButtonClass} { color: red; }`);
    assertEquals(seenStylesheet!.includes(".button { color: red; }"), false);
  });

  it("produces identical module and CSS assets across temporary roots", async () => {
    const files = [
      { path: "components/card.module.css", content: ".root { color: red; }" },
      {
        path: "pages/index.tsx",
        content: 'import styles from "../components/card.module.css"; export default styles.root;',
      },
    ];
    const scopedClass = toScopedCssModuleClass("/components/card.module.css", "root");

    async function build(): Promise<ReleaseAssetManifest> {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient(files, rec, {
        compileProjectCss: (_candidates, stylesheet) =>
          Promise.resolve(compiledCss(stylesheet ?? "")),
      });
      const result = await runReleaseAssetBuild(
        baseInput(client, () => Promise.resolve(`export default ${JSON.stringify(scopedClass)};`)),
        await tmp(),
      );
      assertEquals(result.success, true);
      const manifest = parseReleaseAssetManifest(rec.manifest);
      assertExists(manifest);
      return manifest;
    }

    const first = await build();
    const second = await build();
    assertEquals(first.modules["pages/index.tsx"], second.modules["pages/index.tsx"]);
    assertEquals(first.css, second.css);
  });

  it("still publishes when an imported stylesheet cannot be resolved", async () => {
    for (
      const specifier of ["./missing.css", "theme-package/theme.css", "https://cdn.test/x.css"]
    ) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      let compileCalls = 0;
      const client = makeClient(
        [{
          path: "pages/index.tsx",
          content: `import ${JSON.stringify(specifier)}; export default null;`,
        }],
        rec,
        {
          compileProjectCss: () => {
            compileCalls++;
            return Promise.resolve(compiledCss("body{}"));
          },
        },
      );

      const result = await runReleaseAssetBuild(
        baseInput(client, () => Promise.resolve("export default null;")),
        await tmp(),
      );

      // Assert success explicitly. runReleaseAssetBuild returns a failed result
      // rather than throwing, so awaiting it proves nothing on its own -- an
      // earlier revision of this test said otherwise and was wrong.
      assertEquals(result.success, true, specifier);

      // Used to fail the release. It no longer does, and that is the point: a
      // text match is not knowledge that the build needs the file. The same
      // check could not tell a real import from one inside a comment, a string
      // or an MDX fence, so ordinary source could block a project's releases.
      // Unresolvable means the CSS is not merged, not that the release is
      // refused. Genuine missing-CSS detection belongs on the resolved module
      // graph, over transformed code, where the lexer can be trusted.
      assertExists(rec.manifest, specifier);
      assertEquals(compileCalls > 0, true, specifier);
    }
  });

  it("passes helper-composed CSS candidates to compileProjectCss", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "components/Header.tsx",
        content: `
          const navClass = "h-16 md:h-[4.5rem] lg:h-[5rem]";
          export function Header() {
            return <header className={navClass} />;
          }
        `,
      },
      {
        path: "pages/index.tsx",
        content: 'import { Header } from "../components/Header.tsx"; export default Header;',
      },
    ];
    let seenCandidates: Set<string> | null = null;
    const client = makeClient(files, rec, {
      compileProjectCss: (candidates) => {
        seenCandidates = new Set(candidates);
        return Promise.resolve(compiledCss(".h-16{height:4rem}"));
      },
    });
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertExists(seenCandidates);
    const candidates = seenCandidates as Set<string>;
    assert(candidates.has("h-16"));
    assert(candidates.has("md:h-[4.5rem]"));
    assert(candidates.has("lg:h-[5rem]"));
    assert(
      candidates.has("rounded-full"),
      "framework chat candidates must be included in release CSS compilation",
    );
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

  // Project-root alias (@/) and extensionless imports must join the closure
  // (mirrors transforms/esm/path-resolver.ts alias semantics).
  it("resolves @/ alias and extensionless imports into route closure", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files2 = [
      {
        path: "pages/index.tsx",
        content: 'import App from "@/components/app"; export default () => null;',
      },
      {
        path: "components/app.tsx",
        content: 'import { util } from "../lib/utils"; export default () => null;',
      },
      { path: "lib/utils.ts", content: "export const util = 1;" },
    ];
    const client = makeClient(files2, rec);
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);

    const routeModules = manifest.routes["/"]?.modules ?? [];
    assert(routeModules.includes("pages/index.tsx"), "page entrypoint in route modules");
    assert(routeModules.includes("components/app.tsx"), "@/ alias import in route closure");
    assert(routeModules.includes("lib/utils.ts"), "extensionless transitive import in closure");
  });

  it("derives manifest routes from configured app and pages directories", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [
      {
        path: "veryfront.config.ts",
        content: 'export default { directories: { app: "src\\\\site", pages: "src\\\\pages" } };',
      },
      {
        path: "src\\site\\layout.tsx",
        content: '"use client"; export default function Layout({ children }) { return children; }',
      },
      {
        path: "src\\site\\page.tsx",
        content: '"use client"; export default function Home() { return null; }',
      },
      {
        path: "src\\pages\\about.tsx",
        content: "export default function About() { return null; }",
      },
    ];
    const client = makeClient(files, rec);
    const transform = (s: string) => Promise.resolve(s);

    await runReleaseAssetBuild({
      ...baseInput(client, transform),
      loadConfig: releaseConfigLoader({
        directories: { app: "src\\site", pages: "src\\pages" },
      }),
    }, await tmp());

    const manifest = parseReleaseAssetManifest(rec.manifest);
    assertExists(manifest);

    assertEquals(Object.keys(manifest.routes).sort(), ["/", "/about"]);
    assertEquals(manifest.routes["/"]?.modules, [
      "src/site/page.tsx",
      "src/site/layout.tsx",
    ]);
    assertEquals(manifest.routes["/about"]?.modules, ["src/pages/about.tsx"]);
  });

  it("fails closed on route collisions independently of release file order", async () => {
    const collidingFiles = [
      { path: "pages/index.tsx", content: "export default () => null;" },
      { path: "app/page.tsx", content: "export default () => null;" },
    ];

    for (const files of [collidingFiles, [...collidingFiles].reverse()]) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient(files, rec);
      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertCoverageFailure(result, rec, "route-collision:/");
    }
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

  it("reports downstream failures for both acknowledged active build states", async () => {
    for (const state of ["queued", "building"] as const) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient([], rec, {
        beginReleaseAssetManifestBuild: () => {
          rec.began = true;
          return Promise.resolve({ id: `build-${state}`, manifest_version: 7, state });
        },
        listAllReleaseFiles: () => Promise.reject(new Error(`source listing failed: ${state}`)),
      });

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, false, state);
      assertEquals(rec.states.map(({ state }) => state), ["failed"], state);
    }
  });

  it("preserves the primary build failure when failure reporting also fails", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([], rec, {
      listAllReleaseFiles: () => Promise.reject(new Error("primary source listing failure")),
      reportReleaseAssetManifestState: () =>
        Promise.reject(new Error("secondary state reporting failure")),
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? "", "primary source listing failure");
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

  it("hashes release file contents, not only the file-name set", async () => {
    async function build(content: string): Promise<ReleaseAssetManifest> {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient([{ path: "pages/index.tsx", content }], rec);
      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );
      assertEquals(result.success, true);
      const parsed = parseReleaseAssetManifest(rec.manifest);
      assertExists(parsed);
      return parsed;
    }

    const first = await build("export default 1;");
    const second = await build("export default 2;");

    assert(first.sourceContentHash !== second.sourceContentHash);
  });

  it("fails closed when an upload is not acknowledged", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        uploadReleaseAsset: () => Promise.resolve({ stored: false, existed: false }),
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  });

  it("does not execute accessors on upload acknowledgements", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let accessorCalls = 0;
    const forgedAcknowledgement: Record<string, unknown> = { existed: false };
    Object.defineProperty(forgedAcknowledgement, "stored", {
      enumerable: true,
      get() {
        accessorCalls++;
        return true;
      },
    });
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        uploadReleaseAsset: () =>
          Promise.resolve(
            forgedAcknowledgement as unknown as { stored: boolean; existed: boolean },
          ),
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(accessorCalls, 0);
    assertEquals(rec.manifest, null);
  });

  it("fails closed when PUT does not acknowledge the expected manifest", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        putReleaseAssetManifest: (_version, manifest) => {
          rec.manifest = manifest;
          return Promise.resolve({ state: "failed", manifest_version: 99 });
        },
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  });

  it("requires the PUT acknowledgement to name the exact manifest generation", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        putReleaseAssetManifest: (_version, manifest) => {
          rec.manifest = manifest;
          return Promise.resolve({ state: "ready" });
        },
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  });

  it("does not execute accessors on manifest PUT acknowledgements", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let accessorCalls = 0;
    const forgedAcknowledgement: Record<string, unknown> = { manifest_version: 7 };
    Object.defineProperty(forgedAcknowledgement, "state", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "ready";
      },
    });
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        putReleaseAssetManifest: (_version, manifest) => {
          rec.manifest = manifest;
          return Promise.resolve(
            forgedAcknowledgement as unknown as { state: string; manifest_version?: number },
          );
        },
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(accessorCalls, 0);
    assertEquals(rec.states.map(({ state }) => state), ["failed"]);
  });

  it("rejects unsafe manifest versions before materializing release files", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let listed = false;
    const client = makeClient([], rec, {
      beginReleaseAssetManifestBuild: () =>
        Promise.resolve({ id: "build-1", manifest_version: Number.NaN, state: "building" }),
      listAllReleaseFiles: () => {
        listed = true;
        return Promise.resolve([]);
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(listed, false);
    assertEquals(rec.states, []);
  });

  it("does not execute accessors on build-start acknowledgements", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let accessorCalls = 0;
    let listed = false;
    const forgedAcknowledgement: Record<string, unknown> = {
      id: "build-1",
      manifest_version: 7,
    };
    Object.defineProperty(forgedAcknowledgement, "state", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "building";
      },
    });
    const client = makeClient([], rec, {
      beginReleaseAssetManifestBuild: () =>
        Promise.resolve(
          forgedAcknowledgement as unknown as {
            id: string;
            manifest_version: number;
            state: string;
          },
        ),
      listAllReleaseFiles: () => {
        listed = true;
        return Promise.resolve([]);
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(accessorCalls, 0);
    assertEquals(listed, false);
    assertEquals(rec.states, []);
  });

  it("does not mutate remote state for terminal build-start acknowledgements", async () => {
    for (const state of ["ready", "partial", "failed", "superseded"] as const) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      let listed = false;
      const client = makeClient([], rec, {
        beginReleaseAssetManifestBuild: () => {
          rec.began = true;
          return Promise.resolve({ id: `build-${state}`, manifest_version: 7, state });
        },
        listAllReleaseFiles: () => {
          listed = true;
          return Promise.resolve([]);
        },
      });

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, false, state);
      assertEquals(listed, false, state);
      assertEquals(rec.uploads, [], state);
      assertEquals(rec.manifest, null, state);
      assertEquals(rec.states, [], state);
    }
  });

  it("does not report failure when build start rejects", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    let listed = false;
    const client = makeClient([], rec, {
      beginReleaseAssetManifestBuild: () => Promise.reject(new Error("build start unavailable")),
      listAllReleaseFiles: () => {
        listed = true;
        return Promise.resolve([]);
      },
    });

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(listed, false);
    assertEquals(rec.states, []);
  });

  it("does not report failure before build ownership is established", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient([], rec);
    const input = {
      ...baseInput(client, (source) => Promise.resolve(source)),
      projectId: "",
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertEquals(result.success, false);
    assertEquals(rec.began, false);
    assertEquals(rec.states, []);
  });

  it("rejects non-canonical release file paths", async () => {
    for (const path of ["pages/./index.tsx", "pages//index.tsx"]) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const client = makeClient([{ path, content: "export default null;" }], rec);

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        await tmp(),
      );

      assertEquals(result.success, false, path);
      assertEquals(rec.manifest, null, path);
    }
  });

  it("rejects duplicate slash aliases after normalizing Windows release paths", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [
        { path: "pages\\index.tsx", content: "export default null;" },
        { path: "pages/index.tsx", content: "export default null;" },
      ],
      rec,
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );

    assertEquals(result.success, false);
    assertEquals(rec.manifest, null);
  });

  it("rejects portable case-folding path collisions before materialization", async () => {
    const fileOrders = [
      ["components/Foo.tsx", "components/foo.tsx"],
      ["components/foo.tsx", "components/Foo.tsx"],
    ];
    for (const paths of fileOrders) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const tempDir = await tmp();
      const client = makeClient(
        paths.map((path) => ({ path, content: "export default null;" })),
        rec,
      );

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        tempDir,
      );

      assertEquals(result.success, false, paths.join(","));
      assertEquals(rec.manifest, null, paths.join(","));
      const materialized: string[] = [];
      for await (const entry of Deno.readDir(tempDir)) materialized.push(entry.name);
      assertEquals(materialized, [], paths.join(","));
    }
  });

  it("rejects non-NFC and Windows-reserved release paths", async () => {
    for (const path of ["components/cafe\u0301.tsx", "components/CON.tsx", "lib/name:ads.ts"]) {
      const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
      const tempDir = await tmp();
      const client = makeClient([{ path, content: "export default null;" }], rec);

      const result = await runReleaseAssetBuild(
        baseInput(client, (source) => Promise.resolve(source)),
        tempDir,
      );

      assertEquals(result.success, false, path);
      const materialized: string[] = [];
      for await (const entry of Deno.readDir(tempDir)) materialized.push(entry.name);
      assertEquals(materialized, [], path);
    }
  });

  it("uploads equal JavaScript and CSS bytes under both content identities", async () => {
    const shared = "same release asset bytes";
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "source" }],
      rec,
      {
        compileProjectCss: () => Promise.resolve(compiledCss(shared)),
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, () => Promise.resolve(shared)),
      await tmp(),
    );
    assertEquals(result.success, true);

    const sharedUploads = rec.uploads.filter(({ text }) => text === shared);
    assertEquals(
      sharedUploads.map(({ contentType }) => contentType).sort(),
      ["text/css", "text/javascript"],
    );
  });

  it("fails the release when compiled CSS exceeds the upload boundary", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const oversizedCss = "x".repeat(RELEASE_ASSET_MAX_SIZE_BYTES + 1);
    const client = makeClient(
      [{ path: "pages/index.tsx", content: "export default null;" }],
      rec,
      {
        compileProjectCss: () => Promise.resolve(compiledCss(oversizedCss)),
      },
    );

    const result = await runReleaseAssetBuild(
      baseInput(client, (source) => Promise.resolve(source)),
      await tmp(),
    );
    assertEquals(result.success, false);
    assertEquals(result.state, "failed");
    assertEquals(rec.manifest, null);
    assertEquals(rec.states.at(-1)?.state, "failed");
    assertStringIncludes(result.error ?? "", "CSS output exceeds");
    assertEquals(rec.uploads.some(({ text }) => text.length > RELEASE_ASSET_MAX_SIZE_BYTES), false);
  });

  // M2: modules exceeding the 10 MB limit fail before any upload.
  it("fails closed on oversized modules without uploading (M2)", async () => {
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
    const client = makeClient(files, rec);
    // Return a string > 10 MB (10 * 1024 * 1024 + 1 bytes).
    const bigCode = "x".repeat(10 * 1024 * 1024 + 1);
    const transform = () => Promise.resolve(bigCode);

    const result = await runReleaseAssetBuild(baseInput(client, transform), await tmp());

    assertCoverageFailure(result, rec, "oversized:pages/index.tsx");
  });

  // L3: nested index route derivation.
  it("routeForPage derives nested index routes correctly (L3)", () => {
    assertEquals(routeForPage("pages/index.tsx"), "/");
    assertEquals(routeForPage("pages/about.tsx"), "/about");
    assertEquals(routeForPage("pages/blog/index.tsx"), "/blog");
    assertEquals(routeForPage("pages/blog/post.tsx"), "/blog/post");
    assertEquals(routeForPage("pages/a/b/index.tsx"), "/a/b");
    assertEquals(routeForPage("pages/api/hello.ts"), null);
    assertEquals(routeForPage("pages/api/users/[id].ts"), null);
    assertEquals(routeForPage("pages/index.d.ts"), null);
    assertEquals(routeForPage("pages/blog/post.d.ts"), null);
    assertEquals(routeForPage("pages/index.css"), null);
    assertEquals(routeForPage("pages/_app.tsx"), null);
    assertEquals(routeForPage("pages/_document.tsx"), null);
    assertEquals(routeForPage("pages/blog/_draft.tsx"), null);
    assertEquals(routeForPage("app/page.tsx"), "/");
    assertEquals(routeForPage("app/(marketing)/page.tsx"), "/");
    assertEquals(routeForPage("app/(marketing)/blog/page.tsx"), "/blog");
    assertEquals(routeForPage("app/page.d.ts"), null);
    assertEquals(routeForPage("app/page.css"), null);
    assertEquals(routeForPage("app/@modal/page.tsx"), null);
    assertEquals(routeForPage("app/_components/page.tsx"), null);
    assertEquals(routeForPage("components/Button.tsx"), null);
    assertEquals(routeForPage("pages/../secret.tsx"), null);
    assertEquals(routeForPage("pages/not-a-module.txt"), null);
    assertEquals(routeForPage("pages//index.tsx"), null);
    assertEquals(routeForPage(`pages/${"a".repeat(2_048)}.tsx`), null);
  });

  it("bounds oversized cycle diagnostics before failing the build", async () => {
    enableDependencyImportMap();
    const rec: Recorded = { began: false, uploads: [], manifest: null, states: [] };
    const firstUrl = `https://example.com/${"a".repeat(1_400)}`;
    const secondUrl = `https://example.com/${"b".repeat(1_400)}`;
    const firstPath = "/tmp/veryfront-http-bundle/http-long-a.mjs";
    const secondPath = "/tmp/veryfront-http-bundle/http-long-b.mjs";
    const files = [{
      path: "pages/index.tsx",
      content: "export default null;",
    }];
    const client = makeClient(files, rec);
    const input = {
      ...baseInput(
        client,
        () => Promise.resolve(`import value from "${firstUrl}"; export default value;`),
      ),
      vendorHttpImports: withFakeReactVendor((code: string) =>
        Promise.resolve({
          code: code.replace(firstUrl, `file://${firstPath}`),
          dependencies: [
            {
              specifier: `file://${firstPath}`,
              manifestKey: firstUrl,
              sourcePath: firstPath,
              code: 'import value from "./http-long-b.mjs"; export default value;',
            },
            {
              specifier: `file://${secondPath}`,
              manifestKey: secondUrl,
              sourcePath: secondPath,
              code: 'import value from "./http-long-a.mjs"; export default value;',
            },
          ],
        })
      ),
    };

    const result = await runReleaseAssetBuild(input, await tmp());

    assertCoverageFailure(result, rec, "coverage-failures:detail-limit-exceeded");
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
