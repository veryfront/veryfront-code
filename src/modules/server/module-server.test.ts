import "#veryfront/schemas/_test-setup.ts";
/**
 * Module Server Tests
 *
 * Tests the exported isModuleRequest function and serveModule
 * behavior for various URL patterns, error formatting, and
 * content type detection.
 *
 * @module modules/server/module-server.test
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildServerTimingHeader,
  finalizeRequestProfiling,
  resetRequestProfiles,
  runWithRequestProfiling,
} from "#veryfront/observability/request-profiler.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { getDevModuleContentType, isModuleRequest } from "./module-server.ts";
import { clearReleaseModuleResponseCache } from "./module-response-cache.ts";
import { clearSourceMissCache } from "./module-source-resolution-cache.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
} from "#veryfront/release-assets/constants.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { createImportMapIdentity } from "#veryfront/modules/import-map/index.ts";

describe("isModuleRequest", () => {
  it("should return true for /_vf_modules/ path", () => {
    const req = new Request("http://localhost:3000/_vf_modules/components/Button.tsx");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return true for /_veryfront/modules/ path", () => {
    const req = new Request("http://localhost:3000/_veryfront/modules/lib/utils.ts");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return false for non-module paths", () => {
    assertEquals(isModuleRequest(new Request("http://localhost:3000/")), false);
    assertEquals(isModuleRequest(new Request("http://localhost:3000/api/data")), false);
    assertEquals(isModuleRequest(new Request("http://localhost:3000/pages/index")), false);
  });

  it("should return false for partial prefix match", () => {
    assertEquals(isModuleRequest(new Request("http://localhost:3000/_vf_mod")), false);
    assertEquals(isModuleRequest(new Request("http://localhost:3000/_veryfront/mod")), false);
  });

  it("should return true for /_vf_modules/ with query params", () => {
    const req = new Request("http://localhost:3000/_vf_modules/file.tsx?t=123&ssr=true");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return true for /_vf_modules/_snippets/ path", () => {
    const req = new Request("http://localhost:3000/_vf_modules/_snippets/abc123.js");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return true for /_vf_modules/_cross/ path", () => {
    const req = new Request(
      "http://localhost:3000/_vf_modules/_cross/my-project@1.0.0/@/components/Button.tsx",
    );
    assertEquals(isModuleRequest(req), true);
  });
});

// sanitizeResources disabled: serveModule initialises the esbuild transform
// pipeline which spawns a long-lived child process. This is a pre-existing
// resource that cannot be torn down inside a unit test.
describe({ name: "serveModule", sanitizeResources: false, sanitizeOps: false }, () => {
  afterEach(() => {
    deleteEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
    deleteEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
    deleteEnv("VERYFRONT_ENABLE_SERVER_TIMING");
    deleteEnv("VERYFRONT_CACHE_DIR");
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
    clearReleaseModuleResponseCache();
    resetRequestProfiles();
  });

  async function serve(req: Request, projectDir = "/tmp/test"): Promise<Response> {
    const { serveModule } = await import("./module-server.ts");
    return await serveModule(req, {
      projectId: "test",
      projectDir,
      adapter: denoAdapter,
    });
  }

  async function serveProductionModule(
    req: Request,
    projectDir: string,
    releaseId = "rel-1",
  ): Promise<Response> {
    const { serveModule } = await import("./module-server.ts");
    return await serveModule(req, {
      projectId: "test",
      projectDir,
      adapter: denoAdapter,
      dev: false,
      releaseId,
    });
  }

  function extractChildVersion(code: string): string {
    const match = code.match(/\.\/child\.js\?ssr=true&v=([^"']+)/);
    return match?.[1] ?? "";
  }

  function manifest(
    dependencies: ReleaseAssetManifest["dependencies"],
    releaseId = "release-id",
  ): ReleaseAssetManifest {
    return {
      schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
      projectId: "project-id",
      releaseId,
      releaseVersion: 1,
      manifestVersion: 1,
      builderVersion: "test",
      sourceContentHash: "a".repeat(64),
      createdAt: new Date(0).toISOString(),
      assetBasePath: "/_vf/assets",
      modules: {},
      css: [],
      routes: {},
      dependencies,
      fallback: { mode: "jit", gaps: [] },
    };
  }

  it("isolates hosted SSR transforms by bound import map without ambient config probes", async () => {
    const { serveModule } = await import("./module-server.ts");
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/test-project/page.ts",
      `import mapped from "package"; export default mapped;`,
    );
    let ambientConfigProbes = 0;
    const isConfigPath = (path: string) =>
      /(?:^|\/)(?:deno\.json|veryfront\.config(?:\.[cm]?[jt]s)?)$/.test(path);
    const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
    const originalExists = adapter.fs.exists.bind(adapter.fs);
    const originalStat = adapter.fs.stat.bind(adapter.fs);
    adapter.fs.readFile = (path) => {
      if (isConfigPath(path)) ambientConfigProbes++;
      return originalReadFile(path);
    };
    adapter.fs.exists = (path) => {
      if (isConfigPath(path)) ambientConfigProbes++;
      return originalExists(path);
    };
    adapter.fs.stat = (path) => {
      if (isConfigPath(path)) ambientConfigProbes++;
      return originalStat(path);
    };

    const mapA = await createImportMapIdentity({
      imports: { package: "node:fs" },
      scopes: {},
    });
    const mapB = await createImportMapIdentity({
      imports: { package: "node:path" },
      scopes: {},
    });
    const request = new Request("http://localhost:3000/_vf_modules/page.js?ssr=true");
    const baseOptions = {
      projectId: "project-1",
      projectDir: "/test-project",
      adapter,
      projectUUID: "project-1",
      projectSlug: "test",
      branch: "main",
      releaseId: "release-1",
      reactVersion: "19.1.1",
      dev: false,
    } as const;

    const responseA = await serveModule(request, {
      ...baseOptions,
      importMapIdentity: mapA,
    });
    const responseB = await serveModule(request, {
      ...baseOptions,
      importMapIdentity: mapB,
    });
    const [codeA, codeB] = await Promise.all([responseA.text(), responseB.text()]);

    assertEquals(responseA.status, 200);
    assertEquals(responseB.status, 200);
    assertStringIncludes(codeA, "node:fs");
    assertEquals(codeA.includes("node:path"), false);
    assertStringIncludes(codeB, "node:path");
    assertEquals(codeB.includes("node:fs"), false);
    assertEquals(ambientConfigProbes, 0);
  });

  async function serveProductionModuleWithProfile(
    request: Request,
    projectDir: string,
    releaseId: string,
  ): Promise<{
    body: string;
    cacheControl: string | null;
    record: NonNullable<ReturnType<typeof finalizeRequestProfiling>>;
    status: number;
  }> {
    let record: ReturnType<typeof finalizeRequestProfiling> = null;
    let profiledResponse: Response | undefined;
    const response = await runWithRequestProfiling(
      {
        category: "module",
        method: "GET",
        pathname: "/_vf_modules/components/App.js",
      },
      async () => {
        try {
          profiledResponse = await serveProductionModule(request, projectDir, releaseId);
          return profiledResponse;
        } finally {
          record = finalizeRequestProfiling(profiledResponse?.status);
        }
      },
    );

    return {
      body: await response.text(),
      cacheControl: response.headers.get("cache-control"),
      record: record!,
      status: response.status,
    };
  }

  it("should return 404 for non-module path prefix", async () => {
    const response = await serve(
      new Request("http://localhost:3000/not-a-module?project="),
    );

    assertEquals(response.status, 404);
    assertEquals(await response.text(), "Module not found");
  });

  it("should handle HEAD request for non-module path", async () => {
    const response = await serve(
      new Request("http://localhost:3000/not-a-module", { method: "HEAD" }),
    );

    assertEquals(response.status, 404);
  });

  it("should return 404 for snippet with missing hash", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_snippets/.js"));

    assertEquals(response.status === 404 || response.status === 500, true);
  });

  it("returns 400 for a structurally invalid cross-project import path", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_cross//@/"));

    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid module path");
  });

  it("rejects encoded separators in cross-project module paths before fetching", async () => {
    const response = await serve(
      new Request(
        "http://localhost:3000/_vf_modules/_cross/demo/@/components%2FSecret.ts",
      ),
    );

    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid cross-project import path");
  });

  it("rejects malformed and encoded-separator dev module paths", async () => {
    for (
      const requestUrl of [
        "http://localhost:3000/_vf_modules/components%2FSecret.ts",
        "http://localhost:3000/_vf_modules/components/%ZZ.ts",
      ]
    ) {
      const response = await serve(new Request(requestUrl));
      assertEquals(response.status, 400);
      assertEquals(await response.text(), "Invalid module path");
    }
  });

  it("rejects malformed and ambiguous module query identities before lookup", async () => {
    for (
      const requestUrl of [
        "http://localhost:3000/_vf_modules/page.js?project=",
        "http://localhost:3000/_vf_modules/page.js?project=first&project=second",
        "http://localhost:3000/_vf_modules/page.js?project=not_canonical",
        "http://localhost:3000/_vf_modules/page.js?branch=%0Ahidden",
        "http://localhost:3000/_vf_modules/page.js?t=one&t=two",
      ]
    ) {
      const response = await serve(new Request(requestUrl));
      assertEquals(response.status, 400);
      assertEquals(await response.text(), "Invalid module query");
    }
  });

  it("rejects invalid configured module identities before lookup", async () => {
    const { serveModule } = await import("./module-server.ts");
    const response = await serveModule(
      new Request("http://localhost:3000/_vf_modules/page.js"),
      {
        projectId: "test",
        projectDir: "/tmp/test",
        adapter: denoAdapter,
        projectSlug: "not_canonical",
      },
    );

    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid module identity");
  });

  it("should serve _dnt.shims.js with _veryfront/ prefix", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_dnt.shims.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("dntGlobalThis"), true);
    assertEquals(text.includes("fetch"), true);
  });

  it("should serve _dnt.polyfills.js with _veryfront/ prefix", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_dnt.polyfills.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("export"), true);
  });

  it("should serve _dnt.shims.js without prefix (relative imports)", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_dnt.shims.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("dntGlobalThis"), true);
  });

  it("should serve _dnt.polyfills.js without prefix (relative imports)", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_dnt.polyfills.js"),
    );

    assertEquals(response.status, 200);
  });

  it("should resolve framework directory imports to index files", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/utils"),
    );

    assertEquals(response.status, 200);
  });

  it("should serve remapped framework directories through their resolved platform paths", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/platform/compat/console"),
    );

    assertEquals(response.status, 200);
  });

  it("should serve browser-safe framework version modules without #deno-config", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/utils/version.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("#deno-config"), false);
    assertEquals(text.includes("./version-constant.js"), true);
    assertEquals(/with\s*\{\s*type\s*:\s*["']json["']\s*\}/.test(text), false);
  });

  it("should serve browser React shims imported by npm framework modules", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/react/react.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("export"), true);
    assertEquals(text.includes("https://esm.sh/react@19.2.4"), true);
    assertEquals(text.includes("@veryfront/react-upstream"), false);
  });

  it("should serve browser-safe framework version constants with the embedded version", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/utils/version-constant.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes(VERSION), true);
  });

  it("should serve #deno-config as embedded JS module for browser imports", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_deno-config.js"),
    );

    assertEquals(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assertEquals(contentType.includes("javascript"), true);

    const text = await response.text();
    // esbuild may transform `export default {...}` into other export forms
    assertEquals(text.includes(VERSION), true);
    assertEquals(text.includes("version"), true);
  });

  it("should serve dnt-relative deno.js as embedded JS instead of project deno.json", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-deno-module-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/deno.json`,
        JSON.stringify({ imports: { veryfront: "npm:veryfront" } }),
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/deno.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      const contentType = response.headers.get("content-type") ?? "";
      assertEquals(contentType.includes("javascript"), true);

      const text = await response.text();
      assertEquals(text.includes("export"), true);
      assertEquals(text.includes(VERSION), true);
      assertEquals(text.includes('"imports"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("serves a project-local generated .mjs module (Panda styled-system) — #219", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-mjs-module-" });
    try {
      await Deno.mkdir(`${projectDir}/styled-system/css`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/styled-system/css/index.mjs`,
        `export function css() { return "panda-class"; }\n`,
      );

      // A page's relative import `../../styled-system/css/index.mjs` resolves in
      // the browser to this /_vf_modules/ URL. Before #219 the resolver stripped
      // the .mjs and never probed it back, so this 404'd and hydration failed.
      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/styled-system/css/index.mjs"),
        projectDir,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertStringIncludes(text, "css");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("honors an explicit .mjs request before same-stem fallbacks", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-mjs-collision-" });
    try {
      await Deno.mkdir(`${projectDir}/styled-system/css`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/styled-system/css/index.js`,
        `export const source = "js-fallback";\n`,
      );
      await Deno.writeTextFile(
        `${projectDir}/styled-system/css/index.mjs`,
        `export const source = "mjs-explicit";\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/styled-system/css/index.mjs"),
        projectDir,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertStringIncludes(text, "mjs-explicit");
      assertEquals(text.includes("js-fallback"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not serve CommonJS sources without browser conversion", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-cjs-module-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/legacy.cjs`,
        `module.exports = { source: "commonjs" };\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/legacy.cjs"),
        projectDir,
      );

      assertEquals(response.status, 404);
      assertEquals(await response.text(), "Module not found");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should prefer project deno.js over the dnt-relative deno fallback", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-project-deno-module-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/deno.js`,
        `export const projectDenoModule = true;\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/deno.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertEquals(text.includes("projectDenoModule"), true);
      assertEquals(text.includes(VERSION), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("caches missing project module lookups", async () => {
    clearSourceMissCache("module-server");
    const adapter = createMockAdapter();
    const originalStat = adapter.fs.stat;
    let statCalls = 0;
    adapter.fs.stat = (path: string) => {
      statCalls++;
      return originalStat(path);
    };

    const { serveModule } = await import("./module-server.ts");
    const request = new Request("http://localhost:3000/_vf_modules/components/Missing.js");
    const options = {
      projectId: "test",
      projectDir: "/test-project",
      adapter,
    };

    const firstResponse = await serveModule(request, options);
    assertEquals(firstResponse.status, 404);
    const afterFirstMiss = statCalls;
    assertEquals(afterFirstMiss > 0, true);

    const secondResponse = await serveModule(request, options);
    assertEquals(secondResponse.status, 404);
    assertEquals(statCalls, afterFirstMiss);
  });

  it("scopes missing project module lookups by project identity", async () => {
    clearSourceMissCache("module-server");
    const { serveModule } = await import("./module-server.ts");
    const request = new Request("http://localhost:3000/_vf_modules/components/Missing.js");

    const missingAdapter = createMockAdapter();
    const firstResponse = await serveModule(request, {
      projectId: "fallback-project",
      projectUUID: "project-a",
      projectSlug: "project-a",
      projectDir: "/shared-project-dir",
      adapter: missingAdapter,
    });
    assertEquals(firstResponse.status, 404);

    const presentAdapter = createMockAdapter();
    presentAdapter.fs.files.set(
      "/shared-project-dir/components/Missing.tsx",
      "export const value = 1;",
    );
    const secondResponse = await serveModule(request, {
      projectId: "fallback-project",
      projectUUID: "project-b",
      projectSlug: "project-b",
      projectDir: "/shared-project-dir",
      adapter: presentAdapter,
    });

    assertEquals(secondResponse.status, 200);
  });

  it("should serve dnt shims as JavaScript content type", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_dnt.shims.js"),
    );

    assertEquals(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assertEquals(contentType.includes("javascript"), true);
  });

  it("marks source lookup and transform phases for module Server-Timing", async () => {
    setEnv("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-timing-" });
    let record: ReturnType<typeof finalizeRequestProfiling> = null;

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.ts`,
        `export const value = "https://example.com/docs";\n`,
      );

      const response = await runWithRequestProfiling(
        {
          category: "module",
          method: "GET",
          pathname: "/_vf_modules/components/App.js",
        },
        async () => {
          let profiledResponse: Response | undefined;
          try {
            profiledResponse = await serve(
              new Request("http://localhost:3000/_vf_modules/components/App.js"),
              projectDir,
            );
            return profiledResponse;
          } finally {
            record = finalizeRequestProfiling(profiledResponse?.status);
          }
        },
      );

      assertEquals(response.status, 200);
      const header = buildServerTimingHeader(record!);
      assertEquals(header.includes("module.source_lookup"), true);
      assertEquals(header.includes("module.transform"), true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("sets immutable cache headers for release-versioned production modules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-release-module-cache-" });

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.ts`,
        `export const value = 1;\n`,
      );

      const response = await serveProductionModule(
        new Request(
          `http://localhost:3000/_vf_modules/components/App.js?vf_release=rel-1&vf_runtime=${VERSION}`,
        ),
        projectDir,
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("adds release query params to relative imports in release-versioned modules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-release-relative-imports-" });
    const releaseId = `rel-relative-${crypto.randomUUID()}`;

    try {
      await Deno.mkdir(`${projectDir}/components/blog`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/blog/BlogList.ts`,
        [
          `import { BlogTeaser } from "../../components/blog/BlogTeaser.js";`,
          `import { useArticles } from "./useArticles.js";`,
          `export const value = [BlogTeaser, useArticles];`,
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${projectDir}/components/blog/BlogTeaser.ts`,
        `export const BlogTeaser = "teaser";\n`,
      );
      await Deno.writeTextFile(
        `${projectDir}/components/blog/useArticles.ts`,
        `export const useArticles = "articles";\n`,
      );

      const response = await serveProductionModule(
        new Request(
          `http://localhost:3000/_vf_modules/components/blog/BlogList.js?vf_release=${releaseId}&vf_runtime=${VERSION}`,
        ),
        projectDir,
        releaseId,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertStringIncludes(
        text,
        `"/_vf_modules/components/blog/BlogTeaser.js?vf_release=${releaseId}&vf_runtime=${VERSION}"`,
      );
      assertStringIncludes(
        text,
        `"/_vf_modules/components/blog/useArticles.js?vf_release=${releaseId}&vf_runtime=${VERSION}"`,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("reuses transformed responses for release-versioned production modules", async () => {
    setEnv("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-release-module-response-cache-" });
    const releaseId = `rel-cache-${crypto.randomUUID()}`;
    const request = new Request(
      `http://localhost:3000/_vf_modules/components/App.js?vf_release=${releaseId}&vf_runtime=${VERSION}`,
    );

    async function serveWithProfile(): Promise<{
      body: string;
      record: NonNullable<ReturnType<typeof finalizeRequestProfiling>>;
      status: number;
    }> {
      let record: ReturnType<typeof finalizeRequestProfiling> = null;
      let profiledResponse: Response | undefined;
      const response = await runWithRequestProfiling(
        {
          category: "module",
          method: "GET",
          pathname: "/_vf_modules/components/App.js",
        },
        async () => {
          try {
            profiledResponse = await serveProductionModule(request, projectDir, releaseId);
            return profiledResponse;
          } finally {
            record = finalizeRequestProfiling(profiledResponse?.status);
          }
        },
      );

      return {
        body: await response.text(),
        record: record!,
        status: response.status,
      };
    }

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.ts`,
        `export const value = 1;\n`,
      );

      const first = await serveWithProfile();
      const second = await serveWithProfile();

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(second.body, first.body);
      assertEquals(Boolean(first.record.phases["module.source_lookup"]), true);
      assertEquals(Boolean(first.record.phases["module.transform"]), true);
      assertEquals(second.record.phases["module.response_cache_hit"], 0);
      assertEquals("module.source_lookup" in second.record.phases, false);
      assertEquals("module.transform" in second.record.phases, false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("caches release-versioned modules when the dependency manifest is absent but unused", async () => {
    setEnv("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-release-module-null-manifest-" });
    const releaseId = `rel-null-manifest-${crypto.randomUUID()}`;
    const request = new Request(
      `http://localhost:3000/_vf_modules/components/App.js?vf_release=${releaseId}&vf_runtime=${VERSION}`,
    );

    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "building", manifest: null })
    );

    async function serveWithProfile(): Promise<{
      body: string;
      cacheControl: string | null;
      record: NonNullable<ReturnType<typeof finalizeRequestProfiling>>;
      status: number;
    }> {
      let record: ReturnType<typeof finalizeRequestProfiling> = null;
      let profiledResponse: Response | undefined;
      const response = await runWithRequestProfiling(
        {
          category: "module",
          method: "GET",
          pathname: "/_vf_modules/components/App.js",
        },
        async () => {
          try {
            profiledResponse = await serveProductionModule(request, projectDir, releaseId);
            return profiledResponse;
          } finally {
            record = finalizeRequestProfiling(profiledResponse?.status);
          }
        },
      );

      return {
        body: await response.text(),
        cacheControl: response.headers.get("cache-control"),
        record: record!,
        status: response.status,
      };
    }

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.ts`,
        `export const value = 1;\n`,
      );

      const first = await serveWithProfile();
      const second = await serveWithProfile();

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(first.body, second.body);
      assertEquals(first.cacheControl, "public, max-age=31536000, immutable");
      assertEquals(second.cacheControl, "public, max-age=31536000, immutable");
      assertEquals(Boolean(first.record.phases["module.source_lookup"]), true);
      assertEquals(Boolean(first.record.phases["module.transform"]), true);
      assertEquals(second.record.phases["module.response_cache_hit"], 0);
      assertEquals("module.source_lookup" in second.record.phases, false);
      assertEquals("module.transform" in second.record.phases, false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps unversioned production modules on no-cache headers", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-unversioned-module-cache-" });

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.ts`,
        `export const value = 1;\n`,
      );

      const response = await serveProductionModule(
        new Request("http://localhost:3000/_vf_modules/components/App.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("cache-control"), "no-cache");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("adds a default export for filename-matched browser modules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-client-default-module-" });

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/PlatformOverview.ts`,
        `export const PlatformOverview = () => "ok";\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/components/PlatformOverview.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertStringIncludes(text, "export { PlatformOverview as default };");
      assertEquals(
        /export \{ PlatformOverview as default \};\n\/\/# sourceMappingURL=/.test(text),
        true,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("adds a default export for preview provider modules outside components", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-provider-default-module-" });

    try {
      await Deno.mkdir(`${projectDir}/providers`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/providers/BreakpointsProvider.tsx`,
        `export const BreakpointsProvider = ({ children }) => children;\n`,
      );

      const response = await serve(
        new Request(
          "http://localhost:3000/_vf_modules/providers/BreakpointsProvider.js?studio_embed=true",
        ),
        projectDir,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertStringIncludes(text, "export { BreakpointsProvider as default };");
      assertEquals(
        /export \{ BreakpointsProvider as default \};\n\/\/# sourceMappingURL=/.test(text),
        true,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("adds a default export for filename-matched browser barrel modules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-client-barrel-default-module-" });

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/impl.ts`,
        `export const PlatformOverview = () => "ok";\n`,
      );
      await Deno.writeTextFile(
        `${projectDir}/components/PlatformOverview.ts`,
        `export { PlatformOverview } from "./impl.ts";\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/components/PlatformOverview.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertStringIncludes(text, "export { PlatformOverview as default };");
      assertEquals(
        /export \{ PlatformOverview as default \};\n\/\/# sourceMappingURL=/.test(text),
        true,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rewrites browser module HTTP bundle imports through the release manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-release-assets-" });
    const cacheDir = await Deno.makeTempDir({ prefix: "vf-module-cache-" });
    setEnv("VERYFRONT_CACHE_DIR", cacheDir);
    const dependencyDir = `${cacheDir}/veryfront-http-bundle`;
    const dependencyPath = `${dependencyDir}/http-123abc.mjs`;
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    const hash = "a".repeat(64);

    try {
      await Deno.mkdir(dependencyDir, { recursive: true });
      await Deno.writeTextFile(
        dependencyPath,
        `/*! @vf-source: ${sourceUrl} */\nexport default {};`,
      );
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.tsx`,
        `import React from ${JSON.stringify(`file://${dependencyPath}`)};\nexport default React;\n`,
      );
      configureReleaseAssetManifestFetcher(() =>
        Promise.resolve({
          state: "ready",
          manifest: manifest({
            [sourceUrl]: {
              contentHash: hash,
              size: 100,
              contentType: "text/javascript",
            },
          }),
        })
      );

      const { serveModule } = await import("./module-server.ts");
      const response = await serveModule(
        new Request("http://localhost:3000/_vf_modules/components/App.js"),
        {
          projectId: "test",
          projectDir,
          adapter: denoAdapter,
          releaseId: "release-id",
        },
      );

      assertEquals(response.status, 200);
      const text = await response.text();
      assertEquals(text.includes(`"/_vf/assets/${hash}.js"`), true);
      assertEquals(text.includes("file://"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(cacheDir, { recursive: true });
    }
  });

  it("caches dependency-bearing release modules with partial manifest bodies", async () => {
    setEnv("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-partial-manifest-" });
    const cacheDir = await Deno.makeTempDir({ prefix: "vf-module-partial-cache-" });
    setEnv("VERYFRONT_CACHE_DIR", cacheDir);
    const dependencyDir = `${cacheDir}/veryfront-http-bundle`;
    const dependencyPath = `${dependencyDir}/http-123abc.mjs`;
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    const hash = "c".repeat(64);
    const releaseId = `release-partial-${crypto.randomUUID()}`;
    const request = new Request(
      `http://localhost:3000/_vf_modules/components/App.js?vf_release=${releaseId}&vf_runtime=${VERSION}`,
    );

    try {
      await Deno.mkdir(dependencyDir, { recursive: true });
      await Deno.writeTextFile(
        dependencyPath,
        `/*! @vf-source: ${sourceUrl} */\nexport default {};`,
      );
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.tsx`,
        `import React from ${JSON.stringify(`file://${dependencyPath}`)};\nexport default React;\n`,
      );
      configureReleaseAssetManifestFetcher(() =>
        Promise.resolve({
          state: "partial",
          manifest: manifest({
            [sourceUrl]: {
              contentHash: hash,
              size: 100,
              contentType: "text/javascript",
            },
          }, releaseId),
        })
      );

      const first = await serveProductionModuleWithProfile(request, projectDir, releaseId);
      const second = await serveProductionModuleWithProfile(request, projectDir, releaseId);

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(first.cacheControl, "public, max-age=31536000, immutable");
      assertEquals(second.cacheControl, "public, max-age=31536000, immutable");
      assertStringIncludes(first.body, `"/_vf/assets/${hash}.js"`);
      assertEquals(first.body.includes("file://"), false);
      assertEquals(second.body, first.body);
      assertEquals(first.record.phases["release_manifest.fetch_partial"], 0);
      assertEquals(second.record.phases["module.response_cache_hit"], 0);
      assertEquals("module.source_lookup" in second.record.phases, false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(cacheDir, { recursive: true });
    }
  });

  it("keeps dependency-bearing release modules uncached when manifest rewrites miss", async () => {
    setEnv("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-manifest-miss-" });
    const cacheDir = await Deno.makeTempDir({ prefix: "vf-module-manifest-miss-cache-" });
    setEnv("VERYFRONT_CACHE_DIR", cacheDir);
    const dependencyDir = `${cacheDir}/veryfront-http-bundle`;
    const dependencyPath = `${dependencyDir}/http-123abc.mjs`;
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    const releaseId = `release-manifest-miss-${crypto.randomUUID()}`;
    const request = new Request(
      `http://localhost:3000/_vf_modules/components/App.js?vf_release=${releaseId}&vf_runtime=${VERSION}`,
    );

    try {
      await Deno.mkdir(dependencyDir, { recursive: true });
      await Deno.writeTextFile(
        dependencyPath,
        `/*! @vf-source: ${sourceUrl} */\nexport default {};`,
      );
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.tsx`,
        `import React from ${JSON.stringify(`file://${dependencyPath}`)};\nexport default React;\n`,
      );
      configureReleaseAssetManifestFetcher(() =>
        Promise.resolve({ state: "ready", manifest: manifest({}, releaseId) })
      );

      const first = await serveProductionModuleWithProfile(request, projectDir, releaseId);
      const second = await serveProductionModuleWithProfile(request, projectDir, releaseId);

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(first.cacheControl, "no-cache");
      assertEquals(second.cacheControl, "no-cache");
      assertEquals(first.body.includes(`"/_vf/assets/`), false);
      assertEquals("module.response_cache_store" in first.record.phases, false);
      assertEquals(first.record.phases["module.response_cache_dependency_blocked"], 0);
      assertEquals("module.response_cache_hit" in second.record.phases, false);
      assertEquals(Boolean(second.record.phases["module.source_lookup"]), true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(cacheDir, { recursive: true });
    }
  });

  it("uses child source content for SSR import cache busters", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-ssr-cache-buster-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/page.ts`,
        `import { child } from "./child.js";\nexport const page = child;\n`,
      );
      await Deno.writeTextFile(`${projectDir}/child.ts`, `export const child = "one";\n`);

      const firstResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/page.js?ssr=true"),
        projectDir,
      );
      assertEquals(firstResponse.status, 200);
      const firstVersion = extractChildVersion(await firstResponse.text());

      await Deno.writeTextFile(`${projectDir}/child.ts`, `export const child = "two";\n`);

      const secondResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/page.js?ssr=true"),
        projectDir,
      );
      assertEquals(secondResponse.status, 200);
      const secondVersion = extractChildVersion(await secondResponse.text());

      assertEquals(firstVersion.length > 0, true);
      assertEquals(secondVersion.length > 0, true);
      assertEquals(firstVersion !== secondVersion, true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not cache release module responses before dependency manifest readiness", async () => {
    setEnv("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-release-cache-gate-" });
    const cacheDir = await Deno.makeTempDir({ prefix: "vf-module-cache-gate-" });
    setEnv("VERYFRONT_CACHE_DIR", cacheDir);
    const dependencyDir = `${cacheDir}/veryfront-http-bundle`;
    const dependencyPath = `${dependencyDir}/http-123abc.mjs`;
    const sourceUrl = "https://esm.sh/react@19.2.4?deps=csstype%403.2.3&target=es2022";
    const hash = "b".repeat(64);
    const releaseId = `release-cache-gate-${crypto.randomUUID()}`;
    let ready = false;

    async function serveWithProfile(): Promise<{
      body: string;
      cacheControl: string | null;
      record: NonNullable<ReturnType<typeof finalizeRequestProfiling>>;
      status: number;
    }> {
      const request = new Request(
        `http://localhost:3000/_vf_modules/components/App.js?vf_release=${releaseId}&vf_runtime=${VERSION}`,
      );
      let record: ReturnType<typeof finalizeRequestProfiling> = null;
      let profiledResponse: Response | undefined;
      const response = await runWithRequestProfiling(
        {
          category: "module",
          method: "GET",
          pathname: "/_vf_modules/components/App.js",
        },
        async () => {
          try {
            profiledResponse = await serveProductionModule(request, projectDir, releaseId);
            return profiledResponse;
          } finally {
            record = finalizeRequestProfiling(profiledResponse?.status);
          }
        },
      );

      return {
        body: await response.text(),
        cacheControl: response.headers.get("cache-control"),
        record: record!,
        status: response.status,
      };
    }

    try {
      await Deno.mkdir(dependencyDir, { recursive: true });
      await Deno.writeTextFile(
        dependencyPath,
        `/*! @vf-source: ${sourceUrl} */\nexport default {};`,
      );
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.tsx`,
        `import React from ${JSON.stringify(`file://${dependencyPath}`)};\nexport default React;\n`,
      );
      configureReleaseAssetManifestFetcher(() =>
        Promise.resolve(
          ready
            ? {
              state: "ready",
              manifest: manifest({
                [sourceUrl]: {
                  contentHash: hash,
                  size: 100,
                  contentType: "text/javascript",
                },
              }, releaseId),
            }
            : { state: "building", manifest: null },
        )
      );

      const first = await serveWithProfile();
      ready = true;
      clearCachedReleaseAssetManifests();
      const second = await serveWithProfile();
      const third = await serveWithProfile();

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(third.status, 200);
      assertEquals(first.cacheControl, "no-cache");
      assertEquals(second.cacheControl, "public, max-age=31536000, immutable");
      assertEquals(third.cacheControl, "public, max-age=31536000, immutable");
      assertEquals(first.body.includes(`"/_vf/assets/${hash}.js"`), false);
      assertEquals(second.body.includes(`"/_vf/assets/${hash}.js"`), true);
      assertEquals(third.body, second.body);
      assertEquals("module.response_cache_store" in first.record.phases, false);
      assertEquals(Boolean(second.record.phases["module.source_lookup"]), true);
      assertEquals("module.response_cache_hit" in second.record.phases, false);
      assertEquals(third.record.phases["module.response_cache_hit"], 0);
      assertEquals("module.source_lookup" in third.record.phases, false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(cacheDir, { recursive: true });
    }
  });

  it("serves a TypeScript source request as JavaScript", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-ts-content-type-" });

    try {
      await Deno.mkdir(`${projectDir}/lib`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/lib/constants.ts`,
        `export const SITE_NAME: string = "veryfront";\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/lib/constants.ts"),
        projectDir,
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), "application/javascript; charset=utf-8");
      assertStringIncludes(await response.text(), "SITE_NAME");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("decodes safe URL path segments before project lookup", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-encoded-module-path-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/hello world.ts`,
        `export const greeting = "hello";\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/hello%20world.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      assertStringIncludes(await response.text(), `greeting = "hello"`);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not resolve an explicit source extension to a sibling file", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-exact-source-extension-" });

    try {
      await Deno.mkdir(`${projectDir}/app`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/app/page.ts`,
        `export default function Page() { return "wrong sibling"; }\n`,
      );

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/app/page.tsx"),
        projectDir,
      );

      assertEquals(response.status, 404);

      const siblingResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/app/page.ts"),
        projectDir,
      );
      assertEquals(siblingResponse.status, 200);
      assertStringIncludes(await siblingResponse.text(), "wrong sibling");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("serves a JSON module requested with a .js suffix as JSON", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-json-content-type-" });

    try {
      await Deno.mkdir(`${projectDir}/lib`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/lib/data.json`, `{"a":1}\n`);

      const response = await serve(
        new Request("http://localhost:3000/_vf_modules/lib/data.json.js"),
        projectDir,
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), "application/json; charset=utf-8");
      assertEquals(JSON.parse(await response.text()), { a: 1 });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("getDevModuleContentType", () => {
  // The module server compiles TS/JSX/MDX sources to JavaScript before serving
  // them. Typing the response from the requested source extension yields
  // `application/typescript`, which browsers refuse to execute as a module.
  for (const path of ["lib/constants.ts", "components/Badge.tsx", "a.jsx", "post.mdx", "a.md"]) {
    it(`serves ${path} as JavaScript`, () => {
      assertEquals(getDevModuleContentType(path), "application/javascript; charset=utf-8");
    });
  }

  it("still serves .css as CSS", () => {
    assertEquals(getDevModuleContentType("styles/globals.css"), "text/css; charset=utf-8");
  });

  it("still serves source maps as JSON", () => {
    assertEquals(getDevModuleContentType("pages/index.js.map"), "application/json; charset=utf-8");
  });

  it("serves extensionless paths as JavaScript", () => {
    assertEquals(getDevModuleContentType("pages/index"), "application/javascript; charset=utf-8");
  });

  // The import rewriter appends `.js` to any specifier whose extension it does
  // not recognise, so `@/lib/data.json` reaches the server as `lib/data.json.js`
  // while the body stays raw JSON. Typing that as JavaScript makes the browser
  // throw a syntax error on the first `:` in the object.
  it("serves a JSON module requested with a .js suffix as JSON", () => {
    assertEquals(getDevModuleContentType("lib/data.json.js"), "application/json; charset=utf-8");
  });

  it("serves a CSS module requested with a .js suffix as CSS", () => {
    assertEquals(getDevModuleContentType("styles/globals.css.js"), "text/css; charset=utf-8");
  });

  it("still serves plain .js as JavaScript", () => {
    assertEquals(getDevModuleContentType("lib/legacy.js"), "application/javascript; charset=utf-8");
  });
});
