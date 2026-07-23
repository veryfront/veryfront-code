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
import { isModuleRequest } from "./module-server.ts";
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
import {
  clearSnippetCache,
  rememberCompiledSnippet,
} from "#veryfront/rendering/snippet-renderer.ts";

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
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
    clearReleaseModuleResponseCache();
    clearSnippetCache();
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
    const response = await serve(new Request("http://localhost:3000/not-a-module"));

    assertEquals(response.status, 404);
    assertEquals(await response.text(), "Module not found");
  });

  it("should handle HEAD request for non-module path", async () => {
    const response = await serve(
      new Request("http://localhost:3000/not-a-module", { method: "HEAD" }),
    );

    assertEquals(response.status, 404);
  });

  it("returns the same transform status for GET and HEAD module requests", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-head-status-" });
    try {
      await Deno.writeTextFile(`${projectDir}/broken.ts`, "export const = ;");

      const getResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/broken.js"),
        projectDir,
      );
      const headResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/broken.js", { method: "HEAD" }),
        projectDir,
      );

      assertEquals(getResponse.status, 500);
      assertEquals(headResponse.status, getResponse.status);
      assertEquals(await headResponse.text(), "");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects unsupported methods for module routes", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/page.js", { method: "POST" }),
    );

    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET, HEAD");
  });

  it("rejects encoded traversal and control characters before source lookup", async () => {
    for (const path of ["%252e%252e/secret.js", "bad%00name.js", "bad%5cname.js"]) {
      const response = await serve(
        new Request(`http://localhost:3000/_vf_modules/${path}`),
      );
      assertEquals(response.status, 400);
      assertEquals(await response.text(), "Invalid module path");
    }
  });

  it("should return 404 for snippet with missing hash", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_snippets/.js"));

    assertEquals(response.status === 404 || response.status === 500, true);
  });

  it("does not serve a cached executable snippet to another project", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-scoped-snippet-" });
    const projectScope = "project-a";
    const hash = "a".repeat(64);
    try {
      rememberCompiledSnippet({
        hash,
        code: `export default function ScopedSnippet() { return null; }`,
        projectScope,
      });
      const request = new Request(`http://localhost:3000/_vf_modules/_snippets/${hash}.js`);
      const { serveModule } = await import("./module-server.ts");

      const sameProject = await serveModule(request, {
        projectId: projectScope,
        projectDir,
        adapter: denoAdapter,
      });
      assertEquals(sameProject.status, 200);

      const otherProject = await serveModule(request, {
        projectId: "project-b",
        projectDir,
        adapter: denoAdapter,
      });
      assertEquals(otherProject.status, 404);
      assertEquals(await otherProject.text(), "Snippet not found");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should return 400 for invalid cross-project import path", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_cross//@/"));

    assertEquals(response.status, 400);
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
          manifest: manifest(
            {
              [sourceUrl]: {
                contentHash: hash,
                size: 100,
                contentType: "text/javascript",
              },
            },
            releaseId,
          ),
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
              manifest: manifest(
                {
                  [sourceUrl]: {
                    contentHash: hash,
                    size: 100,
                    contentType: "text/javascript",
                  },
                },
                releaseId,
              ),
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
});
