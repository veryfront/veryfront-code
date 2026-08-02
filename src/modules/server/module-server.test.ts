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
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
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
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
} from "#veryfront/release-assets/constants.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  registerManifestFetcherForRelease,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { buildImportMapJson, clearImportMapCache } from "../../html/utils.ts";

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
    deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
    deleteEnv("VERYFRONT_ENABLE_SERVER_TIMING");
    deleteEnv("VERYFRONT_CACHE_DIR");
    clearReleaseAssetManifestCache();
    clearReleaseModuleResponseCache();
    clearImportMapCache();
    resetRequestProfiles();
  });

  async function serve(req: Request, projectDir = "/tmp/test"): Promise<Response> {
    const { serveModule } = await import("./module-server.ts");
    return await serveModule(req, {
      projectId: "test",
      projectDir,
      adapter: denoAdapter,
      isLocalProject: true,
      allowSSRModuleMode: true,
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
    dependencyMode: ReleaseAssetManifest["dependencyMode"] = "immutable",
    modules: ReleaseAssetManifest["modules"] = {},
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
      modules,
      css: [],
      routes: {},
      dependencyMode,
      dependencies,
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

  it("rejects malformed paths in framework-owned module namespaces", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_snippets/.js"));

    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid module path");

    const malformedCrossProject = await serve(
      new Request(
        "http://localhost:3000/_vf_modules/_cross/demo_project/@/index.js",
      ),
    );
    assertEquals(malformedCrossProject.status, 400);
    assertEquals(await malformedCrossProject.text(), "Invalid module path");
  });

  it("returns 400 for an invalid path in the reserved cross-project namespace", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_cross//@/"));

    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid module path");
  });

  it("redacts internal module failures outside development", async () => {
    const { serveModule } = await import("./module-server.ts");
    const projectDir = "/module-error-redaction";
    const sourcePath = `${projectDir}/page.ts`;
    const secret = "sensitive adapter failure";
    const adapter = createMockAdapter();
    adapter.fs.files.set(sourcePath, "export const page = true;");
    const originalReadFile = adapter.fs.readFileBytesWithinLimit!.bind(adapter.fs);
    adapter.fs.readFileBytesWithinLimit = (path, byteLimit) => {
      if (path === sourcePath) return Promise.reject(new Error(secret));
      return originalReadFile(path, byteLimit);
    };
    const request = new Request("http://localhost:3000/_vf_modules/page.js");
    const options = {
      projectId: "module-error-redaction",
      projectDir,
      adapter,
    };

    const productionResponse = await serveModule(request, {
      ...options,
      dev: false,
    });
    assertEquals(productionResponse.status, 500);
    const productionBody = await productionResponse.text();
    assertEquals(
      productionBody,
      `// Transform Error\nthrow new Error("Module transformation failed");`,
    );
    assertEquals(productionBody.includes(secret), false);

    const developmentResponse = await serveModule(request, {
      ...options,
      dev: true,
    });
    assertEquals(developmentResponse.status, 500);
    assertStringIncludes(await developmentResponse.text(), secret);
  });

  it("does not expose project metadata or server route roots as browser modules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-browser-module-private-" });

    try {
      await Deno.mkdir(`${projectDir}/app/actions`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `export default { secret: "not-browser-data" };`,
      );
      await Deno.writeTextFile(`${projectDir}/package.json`, `{"secret":"not-browser-data"}`);
      await Deno.writeTextFile(
        `${projectDir}/app/actions/save.ts`,
        `export const save = () => "not-browser-code";`,
      );

      for (const path of ["veryfront.config.js", "package.json.js", "app/actions/save.js"]) {
        const response = await serve(
          new Request(`http://localhost:3000/_vf_modules/${path}`),
          projectDir,
        );
        assertEquals(response.status, 404);
        assertEquals((await response.text()).includes("not-browser"), false);
      }

      const headResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/app/actions/save.js", { method: "HEAD" }),
        projectDir,
      );
      assertEquals(headResponse.status, 404);
      assertEquals(await headResponse.text(), "");

      const claimedSsrResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/package.json.js?ssr=true"),
        projectDir,
      );
      assertEquals(claimedSsrResponse.status, 404);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects server-directed source from browser module requests", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-browser-module-boundary-" });

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/server.ts`,
        `"use server"; export const secret = "private";`,
      );
      await Deno.writeTextFile(
        `${projectDir}/components/function-action.ts`,
        `export async function save() { "use server"; return "private"; }`,
      );

      for (const path of ["components/server.js", "components/function-action.js"]) {
        const response = await serve(
          new Request(`http://localhost:3000/_vf_modules/${path}`),
          projectDir,
        );
        assertEquals(response.status, 404);
        assertEquals((await response.text()).includes("private"), false);
      }

      const ssrResponse = await serve(
        new Request("http://localhost:3000/_vf_modules/components/server.js?ssr=true"),
        projectDir,
      );
      assertEquals(ssrResponse.status, 200);
      assertStringIncludes(await ssrResponse.text(), "secret");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not let remote requests spoof the local SSR module capability", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-remote-ssr-spoof-" });

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/server.ts`,
        `"use server"; export const secret = "private";`,
      );

      const { serveModule } = await import("./module-server.ts");
      const options = {
        projectId: "remote-project",
        projectDir,
        adapter: denoAdapter,
        isLocalProject: false,
        // Even a mistakenly broad in-process capability is insufficient unless
        // the project itself was explicitly classified as local.
        allowSSRModuleMode: true,
      } as const;

      for (
        const request of [
          new Request("http://localhost:3000/_vf_modules/components/server.js?ssr=true"),
          new Request("http://localhost:3000/_vf_modules/components/server.js", {
            headers: { "user-agent": "Deno/2.4.0" },
          }),
        ]
      ) {
        const response = await serveModule(request, options);
        assertEquals(response.status, 404);
        assertEquals((await response.text()).includes("private"), false);
      }
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects private and server-only cross-project browser modules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-cross-project-private-" });
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      await Deno.writeTextFile(`${projectDir}/package.json`, `{"name":"local"}`);
      globalThis.fetch = (_input: string | URL | Request) => {
        fetchCalls++;
        return Promise.resolve(
          new Response(`"use server"; export const secret = "private";`, {
            status: 200,
          }),
        );
      };

      const { serveModule } = await import("./module-server.ts");
      const options = {
        projectId: "local-project",
        projectDir,
        adapter: denoAdapter,
        isLocalProject: false,
        allowSSRModuleMode: true,
      } as const;

      for (
        const path of [
          "package.json.js",
          "app/actions/save.js",
          "app/api/private.js",
          ".env.js",
        ]
      ) {
        const response = await serveModule(
          new Request(
            `http://localhost:3000/_vf_modules/_cross/remote@1.0.0/@/${path}?ssr=true`,
          ),
          options,
        );
        assertEquals(response.status, 404);
      }
      assertEquals(fetchCalls, 0);

      const serverOnlyResponse = await serveModule(
        new Request(
          "http://localhost:3000/_vf_modules/_cross/remote@1.0.0/@/components/server.js?ssr=true",
          { headers: { "user-agent": "Deno/2.4.0" } },
        ),
        options,
      );
      assertEquals(serverOnlyResponse.status, 404);
      assertEquals((await serverOnlyResponse.text()).includes("private"), false);
      assertEquals(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("admits production browser modules only from a ready release manifest", async () => {
    // The rollout flag may disable manifest-based rendering optimizations, but
    // it must never disable the production browser-module security boundary.
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "0");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-browser-module-manifest-" });
    const releaseId = `rel-browser-admission-${crypto.randomUUID()}`;
    const hash = "b".repeat(64);

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/App.tsx`,
        `export default function App() { return "safe"; }`,
      );
      await Deno.writeTextFile(
        `${projectDir}/components/Secret.ts`,
        `export const secret = "not-listed";`,
      );
      registerManifestFetcherForRelease(releaseId, () =>
        Promise.resolve({
          state: "ready",
          manifest_version: 1,
          manifest: manifest({}, releaseId, "source", {
            "components/App.tsx": {
              contentHash: hash,
              size: 1,
              contentType: "text/javascript",
            },
          }),
        }));

      const { serveModule } = await import("./module-server.ts");
      const options = {
        projectId: "test",
        projectDir,
        adapter: denoAdapter,
        dev: false,
        mode: "production",
        releaseId,
      } as const;

      const admitted = await serveModule(
        new Request("http://localhost:3000/_vf_modules/components/App.js"),
        options,
      );
      assertEquals(admitted.status, 200);

      const rejected = await serveModule(
        new Request("http://localhost:3000/_vf_modules/components/Secret.js"),
        options,
      );
      assertEquals(rejected.status, 404);
      assertEquals((await rejected.text()).includes("not-listed"), false);

      for (
        const spoofedRequest of [
          new Request(
            "http://localhost:3000/_vf_modules/components/Secret.js?ssr=true",
          ),
          new Request("http://localhost:3000/_vf_modules/components/Secret.js", {
            headers: { "user-agent": "Deno/2.4.0" },
          }),
        ]
      ) {
        const spoofed = await serveModule(spoofedRequest, {
          ...options,
          allowSSRModuleMode: true,
          isLocalProject: false,
        });
        assertEquals(spoofed.status, 404);
        assertEquals((await spoofed.text()).includes("not-listed"), false);
      }
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("fails closed while a production browser manifest is unavailable", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "0");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-browser-module-manifest-wait-" });
    const releaseId = `rel-browser-wait-${crypto.randomUUID()}`;

    try {
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/components/App.ts`, `export const app = true;`);
      registerManifestFetcherForRelease(
        releaseId,
        () => Promise.resolve({ state: "building", manifest_version: 1, manifest: null }),
      );

      const { serveModule } = await import("./module-server.ts");
      const response = await serveModule(
        new Request("http://localhost:3000/_vf_modules/components/App.js"),
        {
          projectId: "test",
          projectDir,
          adapter: denoAdapter,
          dev: false,
          mode: "production",
          releaseId,
        },
      );
      assertEquals(response.status, 503);
      assertEquals(response.headers.get("cache-control"), "no-store");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
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

    registerManifestFetcherForRelease(
      releaseId,
      () => Promise.resolve({ state: "building", manifest_version: 1, manifest: null }),
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
      registerManifestFetcherForRelease("release-id", () =>
        Promise.resolve({
          state: "ready",
          manifest_version: 1,
          manifest: manifest({
            [sourceUrl]: {
              contentHash: hash,
              size: 100,
              contentType: "text/javascript",
            },
          }),
        }));

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

  it("rejects partial manifests and keeps dependency-bearing modules uncached", async () => {
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
      registerManifestFetcherForRelease(releaseId, () =>
        Promise.resolve({
          state: "partial",
          manifest_version: 1,
          manifest: manifest({
            [sourceUrl]: {
              contentHash: hash,
              size: 100,
              contentType: "text/javascript",
            },
          }, releaseId),
        }));

      const first = await serveProductionModuleWithProfile(request, projectDir, releaseId);
      const second = await serveProductionModuleWithProfile(request, projectDir, releaseId);

      assertEquals(first.status, 200);
      assertEquals(second.status, 200);
      assertEquals(first.cacheControl, "no-cache");
      assertEquals(second.cacheControl, "no-cache");
      assertEquals(first.body.includes(`"/_vf/assets/${hash}.js"`), false);
      assertStringIncludes(first.body, sourceUrl);
      assertEquals(first.body.includes("file://"), false);
      assertStringIncludes(second.body, sourceUrl);
      assertEquals(second.body.includes("file://"), false);
      assertEquals(second.body, first.body);
      assertEquals(first.record.phases["release_manifest.fetch_partial"], 0);
      assertEquals("module.response_cache_hit" in second.record.phases, false);
      assertEquals(Boolean(second.record.phases["module.source_lookup"]), true);
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
      registerManifestFetcherForRelease(releaseId, () =>
        Promise.resolve({
          state: "ready",
          manifest_version: 1,
          manifest: manifest({}, releaseId, "source"),
        }));

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

  it("keeps a browser child request on the parent dependency snapshot", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-child-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            react: "18.3.1",
            "snapshot-package": "1.0.0",
          },
        }),
      );
      await Deno.utime(packageJsonPath, new Date(1_000), new Date(1_000));
      await Deno.writeTextFile(
        `${projectDir}/page.ts`,
        `import { child } from "./child.js";\nexport const page = child;\n`,
      );
      await Deno.writeTextFile(
        `${projectDir}/child.ts`,
        [
          `import React from "react";`,
          `import value from "snapshot-package";`,
          `export const child = [React, value];`,
        ].join("\n"),
      );
      const dependencySnapshotA = await getDependencyPinningSnapshot(projectDir);
      const parentUrlA = new URL(
        `http://localhost:3000/_vf_modules/page.js?pins=${
          encodeURIComponent(dependencySnapshotA.cacheKey)
        }`,
      );

      const parentResponse = await serve(
        new Request(parentUrlA),
        projectDir,
      );
      assertEquals(parentResponse.status, 200);
      const parentCode = await parentResponse.text();
      const historicalChildPath = `/_vf_modules/_pins/${
        encodeURIComponent(dependencySnapshotA.cacheKey)
      }/child.js`;
      assertStringIncludes(parentCode, historicalChildPath);
      assertEquals(parentCode.includes("?pins="), false);

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            react: "19.2.4",
            "snapshot-package": "2.0.0",
          },
        }),
      );
      await Deno.utime(packageJsonPath, new Date(2_000), new Date(2_000));
      const dependencySnapshotB = await getDependencyPinningSnapshot(projectDir);

      const currentResponse = await serve(
        new Request(
          `http://localhost:3000/_vf_modules/_pins/${
            encodeURIComponent(dependencySnapshotB.cacheKey)
          }/child.js`,
        ),
        projectDir,
      );
      assertEquals(currentResponse.status, 200);
      const currentCode = await currentResponse.text();
      assertStringIncludes(currentCode, "snapshot-package@2.0.0");
      assertStringIncludes(currentCode, "react@19.2.4");

      const historicalResponse = await serve(
        new Request(new URL(historicalChildPath, parentUrlA)),
        projectDir,
      );
      assertEquals(historicalResponse.status, 200);
      const historicalCode = await historicalResponse.text();
      assertStringIncludes(historicalCode, "snapshot-package@1.0.0");
      assertStringIncludes(historicalCode, "react@18.3.1");
    } finally {
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("path-binds same-origin absolute module literals before strict child lookup", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-absolute-module-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.mkdir(`${projectDir}/shared`, { recursive: true });
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            "absolute-module-fixture": `1.0.0-test.${Date.now()}`,
          },
        }),
      );
      await Deno.writeTextFile(
        `${projectDir}/components/Parent.ts`,
        [
          `export { value as absolute } from "http://93.184.216.34:3000/_vf_modules/shared/Absolute.js";`,
          `export { value as protocol } from "//93.184.216.34:3000/_vf_modules/shared/Protocol.js";`,
          `export { value as foreign } from "https://1.1.1.1/_vf_modules/shared/Foreign.js";`,
        ].join("\n"),
      );
      await Deno.writeTextFile(`${projectDir}/shared/Absolute.ts`, `export const value = "abs";`);
      await Deno.writeTextFile(`${projectDir}/shared/Protocol.ts`, `export const value = "proto";`);

      const snapshot = await getDependencyPinningSnapshot(projectDir);
      const encodedKey = encodeURIComponent(snapshot.cacheKey);
      const parentUrl = new URL(
        `http://93.184.216.34:3000/_vf_modules/_pins/${encodedKey}/components/Parent.js`,
      );
      const absolutePath = `/_vf_modules/_pins/${encodedKey}/shared/Absolute.js`;
      const protocolPath = `/_vf_modules/_pins/${encodedKey}/shared/Protocol.js`;

      const parentResponse = await serve(new Request(parentUrl), projectDir);
      assertEquals(parentResponse.status, 200);
      const parentCode = await parentResponse.text();
      assertStringIncludes(parentCode, absolutePath);
      assertStringIncludes(parentCode, protocolPath);
      assertStringIncludes(
        parentCode,
        "https://1.1.1.1/_vf_modules/shared/Foreign.js",
      );

      for (const childPath of [absolutePath, protocolPath]) {
        const childResponse = await serve(
          new Request(new URL(childPath, parentUrl)),
          projectDir,
        );
        assertEquals(childResponse.status, 200);
      }

      const nestedFetches: string[] = [];
      await withMockFetch(
        async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          const request = input instanceof Request ? input : new Request(input, init);
          const requestUrl = new URL(request.url);
          if (
            requestUrl.origin === parentUrl.origin &&
            requestUrl.pathname.startsWith("/_vf_modules/")
          ) {
            nestedFetches.push(requestUrl.href);
            return await serve(request, projectDir);
          }
          if (requestUrl.origin === "https://1.1.1.1") {
            return new Response(`export const value = "foreign";`, {
              headers: { "content-type": "application/javascript" },
            });
          }
          throw new Error(`Unexpected module fetch: ${requestUrl.href}`);
        },
        async () => {
          const ssrParentUrl = new URL(parentUrl);
          ssrParentUrl.searchParams.set("ssr", "true");
          const ssrParentResponse = await serve(new Request(ssrParentUrl), projectDir);
          assertEquals(ssrParentResponse.status, 200);
          for (const childName of ["Absolute.js", "Protocol.js"]) {
            const childFetch = nestedFetches.find((href) =>
              new URL(href).pathname.endsWith(`/shared/${childName}`)
            );
            assertEquals(childFetch !== undefined, true);
            const childUrl = new URL(childFetch!);
            assertEquals(childUrl.searchParams.get("ssr"), "true");
            assertEquals(childUrl.searchParams.get("pins"), snapshot.cacheKey);
          }
        },
      );
    } finally {
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps cross-project relative children on snapshot A and B", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-cross-project-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const originalFetch = globalThis.fetch;
    const parentSource = [
      `export { child as staticChild } from "./Child.js";`,
      `export { child as staticAliasChild } from "@/shared/Root.js";`,
      `const childPath = "./Child.js";`,
      `const aliasPath = "@/shared/Lazy.js";`,
      `const escapePath = "../../../../Escape.js";`,
      `export const loadChild = () => import(childPath);`,
      `export const loadAliasChild = () => import(aliasPath);`,
      `export const loadEscape = () => import(escapePath);`,
    ].join("\n");
    const childSource = [
      `import React from "react";`,
      `import value from "snapshot-package";`,
      `export const child = [React, value];`,
    ].join("\n");

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
        const requestUrl = input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.href
          : input;
        const pathname = new URL(requestUrl).pathname;
        if (pathname.endsWith("/components/Parent.js")) {
          return Promise.resolve(new Response(parentSource));
        }
        if (pathname.endsWith("/components/Child.js")) {
          return Promise.resolve(new Response(childSource));
        }
        if (
          pathname.endsWith("/shared/Root.js") ||
          pathname.endsWith("/shared/Lazy.js")
        ) {
          return Promise.resolve(new Response(childSource));
        }
        return Promise.resolve(new Response("Not found", { status: 404 }));
      };

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            react: "18.3.1",
            "snapshot-package": "1.0.0",
          },
        }),
      );
      await Deno.utime(packageJsonPath, new Date(1_000), new Date(1_000));
      const dependencySnapshotA = await getDependencyPinningSnapshot(projectDir);

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            react: "19.2.4",
            "snapshot-package": "2.0.0",
          },
        }),
      );
      await Deno.utime(packageJsonPath, new Date(2_000), new Date(2_000));
      const dependencySnapshotB = await getDependencyPinningSnapshot(projectDir);

      const assertCrossProjectSnapshot = async (
        cacheKey: string,
        packageVersion: string,
        reactVersion: string,
      ): Promise<void> => {
        const encodedKey = encodeURIComponent(cacheKey);
        const parentUrl = new URL(
          `http://localhost:3000/_vf_modules/_cross/remote@1.0.0/@/components/Parent.js?pins=${encodedKey}`,
        );
        const expectedParentPath =
          `/_vf_modules/_pins/${encodedKey}/_cross/remote@1.0.0/@/components/Parent.js`;
        const expectedChildPath =
          `/_vf_modules/_pins/${encodedKey}/_cross/remote@1.0.0/@/components/Child.js`;
        const expectedStaticAliasPath =
          `/_vf_modules/_pins/${encodedKey}/_cross/remote@1.0.0/@/shared/Root.js`;
        const expectedComputedAliasPath =
          `/_vf_modules/_pins/${encodedKey}/_cross/remote@1.0.0/@/shared/Lazy.js`;

        const parentResponse = await serve(new Request(parentUrl), projectDir);
        assertEquals(parentResponse.status, 200);
        const parentCode = await parentResponse.text();
        assertStringIncludes(parentCode, expectedChildPath);
        assertStringIncludes(parentCode, expectedStaticAliasPath);
        assertStringIncludes(parentCode, expectedParentPath);
        assertStringIncludes(parentCode, "/*__vf_dependency_pinned__*/");
        assertEquals(parentCode.includes("?pins="), false);

        const helperMatch = parentCode.match(
          /\n(function (__veryfrontPinDynamicImport_*)[\s\S]+)\n$/,
        );
        assertEquals(helperMatch !== null, true);
        const helper = new Function(
          `${helperMatch?.[1]}; return ${helperMatch?.[2]};`,
        )() as (value: unknown, parentUrl: string, modulePath?: string) => string;
        assertEquals(
          helper("./Child.js", parentUrl.href, expectedParentPath),
          expectedChildPath,
        );
        assertEquals(
          helper("@/shared/Lazy.js", parentUrl.href, expectedParentPath),
          expectedComputedAliasPath,
        );
        assertEquals(
          helper("../../../../Escape.js", parentUrl.href, expectedParentPath),
          "/_vf_modules/_pins/invalid",
        );

        for (
          const childPath of [
            expectedChildPath,
            expectedStaticAliasPath,
            expectedComputedAliasPath,
          ]
        ) {
          const childResponse = await serve(
            new Request(new URL(childPath, parentUrl)),
            projectDir,
          );
          assertEquals(childResponse.status, 200);
          const childCode = await childResponse.text();
          assertStringIncludes(childCode, `snapshot-package@${packageVersion}`);
          assertStringIncludes(childCode, `react@${reactVersion}`);
        }
      };

      await assertCrossProjectSnapshot(
        dependencySnapshotB.cacheKey,
        "2.0.0",
        "19.2.4",
      );
      await assertCrossProjectSnapshot(
        dependencySnapshotA.cacheKey,
        "1.0.0",
        "18.3.1",
      );

      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "0");
      const flagOffResponse = await serve(
        new Request(
          "http://localhost:3000/_vf_modules/_cross/remote@1.0.0/@/components/Parent.js",
        ),
        projectDir,
      );
      assertEquals(flagOffResponse.status, 200);
      const flagOffCode = await flagOffResponse.text();
      assertStringIncludes(
        flagOffCode,
        "http://localhost:3000/components/Child.js",
      );
      assertStringIncludes(flagOffCode, "import(childPath)");
      assertEquals(flagOffCode.includes("/_pins/"), false);
    } finally {
      globalThis.fetch = originalFetch;
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps static and computed prefix imports on historical snapshot A after B", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-prefix-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const nestedDir = `${projectDir}/components/nested`;

    function resolvePrefix(
      imports: Record<string, string>,
      prefix: string,
      specifier: string,
    ): string {
      return `${imports[prefix]}${specifier.slice(prefix.length)}`;
    }

    async function assertSnapshotModule(
      moduleUrl: URL,
      packageVersion: string,
      reactVersion: string,
    ): Promise<void> {
      const response = await serve(new Request(moduleUrl), projectDir);
      assertEquals(response.status, 200);
      const code = await response.text();
      assertStringIncludes(code, `snapshot-package@${packageVersion}`);
      assertStringIncludes(code, `react@${reactVersion}`);
    }

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.mkdir(nestedDir, { recursive: true });
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            react: "18.3.1",
            "snapshot-package": "1.0.0",
          },
        }),
      );
      await Deno.utime(packageJsonPath, new Date(1_000), new Date(1_000));
      await Deno.writeTextFile(
        `${nestedDir}/Parent.ts`,
        [
          `export { value as staticValue } from "../StaticChild.js";`,
          `const localPath = "./LocalLazy.js";`,
          `const parentPath = "../LazyChild.js";`,
          `const rootPath = "/_vf_modules/components/LazyChild.js";`,
          `export const loadLocal = () => import(localPath);`,
          `export const loadParent = () => import(parentPath);`,
          `export const loadRoot = () => import(rootPath);`,
        ].join("\n"),
      );
      const childSource = [
        `import React from "react";`,
        `import value from "snapshot-package";`,
        `export { value };`,
        `export const react = React;`,
      ].join("\n");
      await Deno.writeTextFile(`${projectDir}/components/StaticChild.ts`, childSource);
      await Deno.writeTextFile(`${projectDir}/components/LazyChild.ts`, childSource);
      await Deno.writeTextFile(`${nestedDir}/LocalLazy.ts`, childSource);

      const dependencySnapshotA = await getDependencyPinningSnapshot(projectDir);
      const importsA = JSON.parse(
        await buildImportMapJson({
          projectDir,
          dependencyPinningCacheKey: dependencySnapshotA.cacheKey,
          dependencyPinningDependencies: dependencySnapshotA.dependencies,
          customImports: {
            "custom-entry": "/_vf_modules/components/nested/Parent.js",
            "custom-prefix/": "/_vf_modules/components/",
          },
          pretty: false,
        }),
      ).imports as Record<string, string>;

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: {
            react: "19.2.4",
            "snapshot-package": "2.0.0",
          },
        }),
      );
      await Deno.utime(packageJsonPath, new Date(2_000), new Date(2_000));
      const dependencySnapshotB = await getDependencyPinningSnapshot(projectDir);
      const importsB = JSON.parse(
        await buildImportMapJson({
          projectDir,
          dependencyPinningCacheKey: dependencySnapshotB.cacheKey,
          dependencyPinningDependencies: dependencySnapshotB.dependencies,
          customImports: {
            "custom-entry": "/_vf_modules/components/nested/Parent.js",
            "custom-prefix/": "/_vf_modules/components/",
          },
          pretty: false,
        }),
      ).imports as Record<string, string>;

      assertEquals(importsA["@/"]!.endsWith("/"), true);
      assertEquals(importsA["custom-prefix/"]!.endsWith("/"), true);
      assertStringIncludes(importsA["@/"]!, "/_vf_modules/_pins/on%3A");
      assertStringIncludes(importsB["custom-prefix/"]!, "/_vf_modules/_pins/on%3A");

      const prefixParentA = new URL(
        resolvePrefix(importsA, "@/", "@/components/nested/Parent.js"),
        "http://localhost:3000",
      );
      const parentA = new URL(importsA["custom-entry"]!, "http://localhost:3000");
      const parentB = new URL(
        resolvePrefix(
          importsB,
          "custom-prefix/",
          "custom-prefix/nested/Parent.js",
        ),
        "http://localhost:3000",
      );
      assertEquals(parentA.href, prefixParentA.href);

      const currentParentResponse = await serve(new Request(parentB), projectDir);
      assertEquals(currentParentResponse.status, 200);
      const currentParentCode = await currentParentResponse.text();
      assertStringIncludes(currentParentCode, `"../StaticChild.js"`);
      assertStringIncludes(currentParentCode, "/*__vf_dependency_pinned__*/");
      assertStringIncludes(currentParentCode, "localPath,import.meta.url");
      assertStringIncludes(currentParentCode, "parentPath,import.meta.url");
      assertStringIncludes(currentParentCode, "rootPath,import.meta.url");
      assertEquals(currentParentCode.includes("?pins="), false);

      const currentStaticChild = new URL("../StaticChild.js", parentB);
      const currentLocalLazy = new URL("./LocalLazy.js", parentB);
      const currentParentLazy = new URL("../LazyChild.js", parentB);
      assertEquals(currentStaticChild.search, "");
      assertStringIncludes(currentStaticChild.pathname, "/_vf_modules/_pins/on%3A");
      assertStringIncludes(currentLocalLazy.pathname, "/_vf_modules/_pins/on%3A");
      assertStringIncludes(currentParentLazy.pathname, "/_vf_modules/_pins/on%3A");
      await assertSnapshotModule(currentStaticChild, "2.0.0", "19.2.4");
      await assertSnapshotModule(currentLocalLazy, "2.0.0", "19.2.4");
      await assertSnapshotModule(currentParentLazy, "2.0.0", "19.2.4");

      const currentHelperMatch = currentParentCode.match(
        /\n(function (__veryfrontPinDynamicImport_*)[\s\S]+)\n$/,
      );
      assertEquals(currentHelperMatch !== null, true);
      const currentHelper = new Function(
        `${currentHelperMatch?.[1]}; return ${currentHelperMatch?.[2]};`,
      )() as (value: unknown, parentUrl: string, modulePath?: string) => string;
      const currentRootLazy = new URL(
        currentHelper(
          "/_vf_modules/components/LazyChild.js",
          parentB.href,
          parentB.pathname,
        ),
        parentB,
      );
      await assertSnapshotModule(currentRootLazy, "2.0.0", "19.2.4");

      const historicalParentResponse = await serve(new Request(parentA), projectDir);
      assertEquals(historicalParentResponse.status, 200);
      const historicalParentCode = await historicalParentResponse.text();
      assertStringIncludes(historicalParentCode, `"../StaticChild.js"`);
      assertStringIncludes(historicalParentCode, "/*__vf_dependency_pinned__*/");
      assertStringIncludes(historicalParentCode, "localPath,import.meta.url");
      assertStringIncludes(historicalParentCode, "parentPath,import.meta.url");
      assertStringIncludes(historicalParentCode, "rootPath,import.meta.url");
      assertEquals(historicalParentCode.includes("?pins="), false);

      const historicalStaticChild = new URL("../StaticChild.js", parentA);
      const historicalLocalLazy = new URL("./LocalLazy.js", parentA);
      const historicalParentLazy = new URL("../LazyChild.js", parentA);
      await assertSnapshotModule(historicalStaticChild, "1.0.0", "18.3.1");
      await assertSnapshotModule(historicalLocalLazy, "1.0.0", "18.3.1");
      await assertSnapshotModule(historicalParentLazy, "1.0.0", "18.3.1");

      const historicalHelperMatch = historicalParentCode.match(
        /\n(function (__veryfrontPinDynamicImport_*)[\s\S]+)\n$/,
      );
      assertEquals(historicalHelperMatch !== null, true);
      const historicalHelper = new Function(
        `${historicalHelperMatch?.[1]}; return ${historicalHelperMatch?.[2]};`,
      )() as (value: unknown, parentUrl: string, modulePath?: string) => string;
      const historicalRootLazy = new URL(
        historicalHelper(
          "/_vf_modules/components/LazyChild.js",
          parentA.href,
          parentA.pathname,
        ),
        parentA,
      );
      await assertSnapshotModule(historicalRootLazy, "1.0.0", "18.3.1");

      for (
        const escapedUrl of [
          new URL("../../../Escape.js", parentA),
          new URL("../../../../Escape.js", parentA),
        ]
      ) {
        const response = await serve(new Request(escapedUrl), projectDir);
        assertEquals(response.status, 409);
        assertEquals(response.headers.get("cache-control"), "no-store");
      }
    } finally {
      clearReactVersionCache();
      clearImportMapCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps flag-off prefix graphs byte-compatible and query-free", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-prefix-off-" });
    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "0");
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/components/Parent.ts`,
        [
          `export { default as staticValue } from "./Static.js";`,
          `const path = "./Lazy.js";`,
          `export const load = () => import(path);`,
        ].join("\n"),
      );
      await Deno.writeTextFile(`${projectDir}/components/Lazy.ts`, "export default 1;\n");
      await Deno.writeTextFile(`${projectDir}/components/Static.ts`, "export default 2;\n");

      const common = {
        projectDir,
        customImports: {
          "custom-prefix/": "/_vf_modules/components/",
        },
        pretty: false,
      };
      const unkeyed = await buildImportMapJson(common);
      const flagOff = await buildImportMapJson({
        ...common,
        dependencyPinningCacheKey: "off",
      });
      assertEquals(flagOff, unkeyed);

      const imports = JSON.parse(flagOff).imports as Record<string, string>;
      const parentUrl = new URL(
        `${imports["custom-prefix/"]}Parent.js`,
        "http://localhost:3000",
      );
      assertEquals(parentUrl.pathname, "/_vf_modules/components/Parent.js");
      assertEquals(parentUrl.search, "");

      const parentResponse = await serve(new Request(parentUrl), projectDir);
      assertEquals(parentResponse.status, 200);
      const parentCode = await parentResponse.text();
      assertStringIncludes(parentCode, `"./Static.js"`);
      assertStringIncludes(parentCode, "import(path)");
      assertEquals(parentCode.includes("/_vf_modules/components/Static.js"), false);

      const childUrl = new URL("./Lazy.js", parentUrl);
      assertEquals(childUrl.pathname, "/_vf_modules/components/Lazy.js");
      assertEquals(childUrl.search, "");
      assertEquals((await serve(new Request(childUrl), projectDir)).status, 200);
    } finally {
      clearReactVersionCache();
      clearImportMapCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("serves ordinary _pins project paths without confusing them for transport", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-pins-source-" });
    try {
      await Deno.mkdir(`${projectDir}/_pins/project-dir`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({
          dependencies: { react: "19.2.4" },
        }),
      );
      await Deno.writeTextFile(`${projectDir}/_pins/foo.ts`, "export default 'foo';\n");
      await Deno.writeTextFile(
        `${projectDir}/_pins/project-dir/bar.ts`,
        "export default 'bar';\n",
      );

      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "0");
      for (
        const path of [
          "/_vf_modules/_pins/foo.js",
          "/_vf_modules/_pins/project-dir/bar.js",
        ]
      ) {
        assertEquals(
          (await serve(new Request(`http://localhost:3000${path}`), projectDir)).status,
          200,
        );
      }

      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      const snapshot = await getDependencyPinningSnapshot(projectDir);
      const encodedSnapshot = encodeURIComponent(snapshot.cacheKey);
      for (
        const path of [
          `/_vf_modules/_pins/${encodedSnapshot}/_pins/foo.js`,
          `/_vf_modules/_pins/${encodedSnapshot}/_pins/project-dir/bar.js`,
        ]
      ) {
        assertEquals(
          (await serve(new Request(`http://localhost:3000${path}`), projectDir)).status,
          200,
        );
      }

      const unknown = await serve(
        new Request(
          "http://localhost:3000/_vf_modules/_pins/on%3Aunknown/_pins/foo.js",
        ),
        projectDir,
      );
      assertEquals(unknown.status, 409);
      assertEquals(unknown.headers.get("cache-control"), "no-store");
    } finally {
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps release fallback static and computed children inside the path snapshot", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-release-path-pins-" });
    const releaseId = "rel-path-pins";
    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.mkdir(`${projectDir}/components`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({
          dependencies: {
            react: "18.3.1",
            "snapshot-package": "1.0.0",
          },
        }),
      );
      await Deno.writeTextFile(
        `${projectDir}/components/Parent.ts`,
        [
          `export { value as staticValue } from "./StaticChild.js";`,
          `const lazyPath = "./LazyChild.js";`,
          `export const load = () => import(lazyPath);`,
        ].join("\n"),
      );
      const childSource = [
        `import React from "react";`,
        `import value from "snapshot-package";`,
        `export { value };`,
        `export const react = React;`,
      ].join("\n");
      await Deno.writeTextFile(
        `${projectDir}/components/StaticChild.ts`,
        childSource,
      );
      await Deno.writeTextFile(
        `${projectDir}/components/LazyChild.ts`,
        childSource,
      );
      clearReactVersionCache();
      const snapshot = await getDependencyPinningSnapshot(projectDir);
      const encodedSnapshot = encodeURIComponent(snapshot.cacheKey);
      const parentUrl = new URL(
        `http://localhost:3000/_vf_modules/_pins/${encodedSnapshot}/components/Parent.js` +
          `?vf_release=${releaseId}&vf_runtime=${VERSION}`,
      );

      const parentResponse = await serveProductionModule(
        new Request(parentUrl),
        projectDir,
        releaseId,
      );
      assertEquals(parentResponse.status, 200);
      const parentCode = await parentResponse.text();
      const staticMatch = parentCode.match(
        /["'](\/_vf_modules\/_pins\/[^"']+\/components\/StaticChild\.js\?[^"']+)["']/,
      );
      assertEquals(staticMatch !== null, true);
      assertStringIncludes(staticMatch?.[1] ?? "", `vf_release=${releaseId}`);
      assertStringIncludes(staticMatch?.[1] ?? "", `vf_runtime=${VERSION}`);
      assertEquals((staticMatch?.[1] ?? "").includes("pins="), false);

      const staticResponse = await serveProductionModule(
        new Request(new URL(staticMatch?.[1] ?? "", parentUrl)),
        projectDir,
        releaseId,
      );
      assertEquals(staticResponse.status, 200);
      const staticCode = await staticResponse.text();
      assertStringIncludes(staticCode, "snapshot-package@1.0.0");
      assertStringIncludes(staticCode, "react@18.3.1");

      const helperMatch = parentCode.match(
        /\n(function (__veryfrontPinDynamicImport_*)[\s\S]+)\n$/,
      );
      assertEquals(helperMatch !== null, true);
      const helper = new Function(
        `${helperMatch?.[1]}; return ${helperMatch?.[2]};`,
      )() as (value: unknown, parentUrl: string, modulePath?: string) => string;
      const lazyUrl = new URL(
        helper("./LazyChild.js", parentUrl.href, parentUrl.pathname),
        parentUrl,
      );
      assertStringIncludes(lazyUrl.pathname, `/_vf_modules/_pins/${encodedSnapshot}/`);
      assertEquals(lazyUrl.searchParams.has("pins"), false);

      const lazyResponse = await serveProductionModule(
        new Request(lazyUrl),
        projectDir,
        releaseId,
      );
      assertEquals(lazyResponse.status, 200);
      const lazyCode = await lazyResponse.text();
      assertStringIncludes(lazyCode, "snapshot-package@1.0.0");
      assertStringIncludes(lazyCode, "react@18.3.1");
    } finally {
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects missing, duplicate, malformed, and unknown dependency snapshots", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-invalid-pins-" });
    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      await Deno.writeTextFile(`${projectDir}/page.ts`, "export default 1;\n");
      clearReactVersionCache();
      const snapshot = await getDependencyPinningSnapshot(projectDir);
      const encodedSnapshot = encodeURIComponent(snapshot.cacheKey);

      for (
        const pathAndQuery of [
          "/_vf_modules/page.js",
          "/_vf_modules/page.js?pins=",
          "/_vf_modules/page.js?pins=off",
          "/_vf_modules/page.js?pins=on%3Afirst&pins=on%3Asecond",
          "/_vf_modules/page.js?pins=on%3Aunknown",
          "/_vf_modules/page.js?pins=on%3Amissing",
          "/_vf_modules/_pins/not-terminated",
          "/_vf_modules/_pins/%E0%A4%A/page.js",
          `/_vf_modules/_pins/${encodedSnapshot}`,
          `/_vf_modules/_pins/${encodedSnapshot}/page.js?pins=${encodedSnapshot}`,
          `/_vf_modules/_pins/${encodedSnapshot}/page.js?pins=on%3Aother`,
          `/_vf_modules/_pins/${encodedSnapshot}/_pins/${encodedSnapshot}/page.js`,
        ]
      ) {
        const response = await serve(
          new Request(`http://localhost:3000${pathAndQuery}`),
          projectDir,
        );
        assertEquals(response.status, 409);
        assertEquals(response.headers.get("cache-control"), "no-store");
      }
    } finally {
      clearReactVersionCache();
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
      registerManifestFetcherForRelease(releaseId, () =>
        Promise.resolve(
          ready
            ? {
              state: "ready",
              manifest_version: 1,
              manifest: manifest({
                [sourceUrl]: {
                  contentHash: hash,
                  size: 100,
                  contentType: "text/javascript",
                },
              }, releaseId),
            }
            : { state: "building", manifest_version: 1, manifest: null },
        ));

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
