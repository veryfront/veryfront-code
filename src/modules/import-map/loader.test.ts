import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { VeryfrontConfig } from "#veryfront/config";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadImportMap } from "./loader.ts";

interface RuntimeWorker {
  subscribe(
    onMessage: (value: unknown) => void,
    onError: (error: unknown) => void,
  ): void;
  terminate(): void;
}

async function createRuntimeWorker(url: URL): Promise<RuntimeWorker> {
  if (typeof globalThis.Worker === "function") {
    const worker = new globalThis.Worker(url, { type: "module" });
    return {
      subscribe(onMessage, onError) {
        worker.onmessage = (event) => onMessage(event.data);
        worker.onerror = (event) => onError(event.error ?? new Error(event.message));
      },
      terminate() {
        worker.terminate();
      },
    };
  }

  const { Worker: NodeWorker } = await import("node:worker_threads");
  const worker = new NodeWorker(url);
  return {
    subscribe(onMessage, onError) {
      worker.once("message", onMessage);
      worker.once("error", onError);
    },
    terminate() {
      void worker.terminate();
    },
  };
}

describe("modules/import-map/loader", () => {
  describe("loadImportMap", () => {
    it("should return an import map with imports", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/nonexistent-project", adapter);

      assertEquals(typeof result, "object");
      assertExists(result.imports);
    });

    it("should always include React mappings", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assertExists(imports);
      assert("react" in imports, "should include react mapping");
      assert("react-dom" in imports, "should include react-dom mapping");
      assert("react/" in imports, "should include authoritative react prefix mapping");
      assert("react-dom/" in imports, "should include authoritative react-dom prefix mapping");
    });

    it("keeps React package prefixes authoritative over project mappings", async () => {
      const adapter = createMockAdapter();
      const config = {
        resolve: {
          importMap: {
            imports: {
              "react/": "https://project.example/react/",
              "react/compiler-runtime": "https://project.example/react-compiler.js",
              "react-dom/": "https://project.example/react-dom/",
              "react-dom/static": "https://project.example/react-dom-static.js",
            },
            scopes: {
              "/app/": {
                react: "https://project.example/scoped-react.js",
                "react-dom/static": "https://project.example/scoped-react-dom.js",
                "veryfront/router": "https://project.example/scoped-router.js",
                package: "https://project.example/package.js",
              },
            },
          },
        },
      } as VeryfrontConfig;

      const { imports, scopes } = await loadImportMap("/any-project", adapter, config);

      assertExists(imports);
      assertExists(scopes);
      assertEquals(imports["react/"]?.startsWith("https://esm.sh/react@"), true);
      assertEquals(imports["react-dom/"]?.startsWith("https://esm.sh/react-dom@"), true);
      assertEquals(imports["react/"]?.endsWith("/"), true);
      assertEquals(imports["react-dom/"]?.endsWith("/"), true);
      assertEquals(imports["react/compiler-runtime"], undefined);
      assertEquals(imports["react-dom/static"], undefined);
      assertEquals(scopes["/app/"]?.react, undefined);
      assertEquals(scopes["/app/"]?.["react-dom/static"], undefined);
      assertEquals(scopes["/app/"]?.["veryfront/router"], undefined);
      assertEquals(scopes["/app/"]?.package, "https://project.example/package.js");
    });

    it("throws the registered import-map error for malformed explicit config", async () => {
      const adapter = createMockAdapter();
      const config = {
        resolve: {
          importMap: {
            imports: { package: 42 },
          },
        },
      } as unknown as VeryfrontConfig;

      const error = await assertRejects(() => loadImportMap("/any-project", adapter, config));

      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "import-map-invalid");
      assertEquals(error.detail, "Veryfront config resolve importMap is invalid");
      assertEquals(error.detail?.includes("42"), false);
    });

    it("ignores extra explicit config import-map metadata without invoking accessors", async () => {
      const adapter = createMockAdapter();
      let metadataCalls = 0;
      const importMap = {
        imports: { package: "https://project.example/package.js" },
      };
      Object.defineProperty(importMap, "metadata", {
        enumerable: true,
        get() {
          metadataCalls++;
          return { source: "project" };
        },
      });
      const config = {
        resolve: { importMap },
      } as VeryfrontConfig;

      const { imports } = await loadImportMap("/any-project", adapter, config);

      assertEquals(imports?.package, "https://project.example/package.js");
      assertEquals(metadataCalls, 0);
    });

    it("rejects config accessors without invoking project code", async () => {
      const adapter = createMockAdapter();
      let accessorCalls = 0;
      const config = {} as VeryfrontConfig;
      Object.defineProperty(config, "resolve", {
        enumerable: true,
        get() {
          accessorCalls++;
          return {};
        },
      });

      const error = await assertRejects(() => loadImportMap("/any-project", adapter, config));

      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "import-map-invalid");
      assertEquals(error.detail, "Veryfront config cannot contain accessor properties");
      assertEquals(accessorCalls, 0);
    });

    it("should include veryfront framework mappings", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assertExists(imports);
      assert("veryfront/head" in imports, "should have veryfront/head");
      assert("veryfront/router" in imports, "should have veryfront/router");
      assert("veryfront/context" in imports, "should have veryfront/context");
    });

    it("should not include npm: specifiers in output", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      for (const [key, value] of Object.entries(imports ?? {})) {
        assert(
          !value.startsWith("npm:"),
          `Import "${key}" should not use npm: specifier, got: ${value}`,
        );
      }
    });

    it("should return consistent results for same path", async () => {
      const adapter = createMockAdapter();
      const result1 = await loadImportMap("/project-a", adapter);
      const result2 = await loadImportMap("/project-a", adapter);

      assertEquals(
        Object.keys(result1.imports ?? {}).length,
        Object.keys(result2.imports ?? {}).length,
      );
    });

    it("should handle deno.json without imports or scopes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/loader-test-project/deno.json",
        JSON.stringify({ compilerOptions: {} }),
      );

      const { imports } = await loadImportMap("/loader-test-project", adapter);

      assertExists(imports);
      assert("react" in imports, "should include default react");
    });

    it("should handle malformed deno.json gracefully", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/loader-bad-json/deno.json", "not valid json{");

      const { imports } = await loadImportMap("/loader-bad-json", adapter);

      assertExists(imports);
      assert("react" in imports, "should include default react");
    });

    it("probes a canonical deno.json path when the project path has a trailing slash", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/trailing-slash-project/deno.json",
        JSON.stringify({
          imports: { "project-package": "https://esm.sh/project-package@1" },
        }),
      );

      const { imports } = await loadImportMap("/trailing-slash-project/", adapter);

      assertEquals(imports?.["project-package"], "https://esm.sh/project-package@1");
    });

    it("should use esm.sh URLs for React", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assertExists(imports);
      const reactUrl = imports["react"];
      assertExists(reactUrl);
      assert(
        reactUrl.includes("esm.sh") || reactUrl.startsWith("file://"),
        `Expected esm.sh or file:// URL for react, got: ${reactUrl}`,
      );
    });

    it("should include react jsx-runtime mapping", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assert(
        "react/jsx-runtime" in (imports ?? {}),
        "should include react/jsx-runtime mapping",
      );
    });

    it("should filter out relative paths from deno.json imports", async () => {
      // Relative paths like ./src/foo are for Deno native resolution,
      // not for browser/SSR module loading via /_vf_modules/
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-with-relative/deno.json",
        JSON.stringify({
          imports: {
            "veryfront/router": "./src/react/router/index.tsx",
            "my-lib": "../external/lib.ts",
            "valid-lib": "https://esm.sh/valid-lib",
          },
        }),
      );

      const { imports } = await loadImportMap("/project-with-relative", adapter);

      assertExists(imports);
      // Default import map has veryfront/router, should not be overwritten by relative path
      assert("veryfront/router" in imports, "should have veryfront/router");
      const routerPath = imports["veryfront/router"];
      assert(
        routerPath?.startsWith("/_vf_modules/"),
        `veryfront/router should use /_vf_modules/, got: ${routerPath}`,
      );
      // Relative path imports should be filtered out
      assert(!("my-lib" in imports), "relative ../external path should be filtered");
      // Non-relative paths should be kept
      assert("valid-lib" in imports, "https:// path should be kept");
    });

    it("should keep veryfront framework mappings local when deno.json uses npm overrides", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-with-npm-overrides/deno.json",
        JSON.stringify({
          imports: {
            "veryfront": "npm:veryfront@0.1.759",
            "veryfront/chat": "npm:veryfront@0.1.759/chat",
            "veryfront/router": "npm:veryfront@0.1.759/router",
            "react": "npm:react@19.1.1",
          },
        }),
      );

      const { imports } = await loadImportMap("/project-with-npm-overrides", adapter);

      assertExists(imports);
      assertEquals(
        imports["veryfront/chat"]?.startsWith("/_vf_modules/_veryfront/chat/"),
        true,
      );
      assertEquals(
        imports["veryfront/router"]?.startsWith("/_vf_modules/_veryfront/react/runtime/core.js"),
        true,
      );
      assertEquals(imports["veryfront/chat"]?.includes("esm.sh"), false);
      assertEquals(imports["veryfront/router"]?.includes("esm.sh"), false);
    });

    it("should filter out relative paths from deno.json scopes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-with-scoped-relative/deno.json",
        JSON.stringify({
          scopes: {
            "/app/": {
              "relative": "./local/module.ts",
              "absolute": "https://esm.sh/some-lib",
            },
          },
        }),
      );

      const { scopes } = await loadImportMap("/project-with-scoped-relative", adapter);

      assertExists(scopes);
      const appScope = scopes["/app/"];
      assertExists(appScope);
      assert(!("relative" in appScope), "relative path in scope should be filtered");
      assert("absolute" in appScope, "absolute path in scope should be kept");
    });

    it("keeps dependency resolution deterministic after primordial poisoning", async () => {
      const worker = await createRuntimeWorker(
        new URL("./loader-primordial-poisoning.worker.ts", import.meta.url),
      );
      try {
        const result = await new Promise<{
          denoOnly: string | undefined;
          package: string | undefined;
          react: string | undefined;
        }>((resolve, reject) => {
          worker.subscribe((value) => {
            const message = value as
              | { ok: true; result: Parameters<typeof resolve>[0] }
              | { ok: false; error: string };
            if (message.ok) resolve(message.result);
            else reject(new Error(message.error));
          }, reject);
        });

        assertEquals(result.denoOnly, "https://example.com/deno.ts");
        assertEquals(result.package, "https://esm.sh/package@1.0.0?target=es2022");
        assert(result.react?.includes("esm.sh"));
      } finally {
        worker.terminate();
      }
    });
  });
});
