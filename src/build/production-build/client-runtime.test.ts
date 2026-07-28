import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type { Bundler, BundleResult, BundlerPluginBuild } from "veryfront/extensions/bundler";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import {
  generateAppModule,
  generateClientModule,
  generateImportMap,
  generatePrefetchScript,
  generateRouterScript,
} from "./client-runtime.ts";

function bundleResult(text: string): BundleResult {
  const contents = new TextEncoder().encode(text);
  return {
    outputFiles: [{ path: "<stdout>", contents, text }],
    warnings: [],
    errors: [],
  };
}

async function withBundler<T>(bundler: Bundler, operation: () => Promise<T>): Promise<T> {
  const previous = tryResolve<Bundler>("Bundler");
  register("Bundler", bundler);
  try {
    return await operation();
  } finally {
    unregister("Bundler");
    if (previous !== undefined) register("Bundler", previous);
  }
}

describe(
  "build/production-build/client-runtime",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await esbuild.stop();
    });

    describe("generateAppModule", () => {
      function getResult(): string {
        return generateAppModule();
      }

      it("should return a non-empty string", () => {
        const result = getResult();
        assertEquals(typeof result, "string");
        assertEquals(result.length > 0, true);
      });

      it("should contain version export", () => {
        const result = getResult();
        assertEquals(result.includes("export const version"), true);
        assertEquals(result.includes("2.0.0"), true);
      });

      it("should contain hydrate export", () => {
        const result = getResult();
        assertEquals(result.includes("export const hydrate"), true);
      });

      it("should contain window.__veryfront setup", () => {
        const result = getResult();
        assertEquals(result.includes("window.__veryfront"), true);
        assertEquals(result.includes("__veryfront.initialized"), true);
      });

      it("should set data-hydrated attribute on root element", () => {
        const result = getResult();
        assertEquals(result.includes("data-hydrated"), true);
        assertEquals(result.includes("getElementById('root')"), true);
      });
    });

    describe(
      "generateClientModule",
      { sanitizeOps: false, sanitizeResources: false },
      () => {
        let result: string;

        beforeAll(async () => {
          result = await generateClientModule();
        });

        it("should return a non-empty string", () => {
          assertEquals(typeof result, "string");
          assertEquals(result.length > 0, true);
        });

        it("should produce ESM output", () => {
          assertEquals(
            result.includes("import") || result.includes("export"),
            true,
            "bundled output should contain ESM syntax",
          );
        });

        it("should contain router class", () => {
          assertEquals(
            result.includes("VeryfrontRouter"),
            true,
            "bundled output should contain VeryfrontRouter class",
          );
        });

        it("should export the static page boot function", () => {
          assertEquals(
            result.includes("boot"),
            true,
            "bundled output should contain the static page boot export",
          );
        });

        it("should not emit unresolved internal aliases", () => {
          assertEquals(
            result.includes("#veryfront/"),
            false,
            "client runtime bundle should resolve internal aliases before browser delivery",
          );
        });

        it("should match a freshly generated source bundle", async () => {
          const sourceBundle = await generateClientModule({ forceSourceBundle: true });
          assertEquals(
            result,
            sourceBundle,
            "embedded router bundle should match source generation output",
          );
        });
      },
    );

    describe("source bundle safety", () => {
      it("does not stop a process-global bundler it does not own", async () => {
        let stopCalls = 0;
        const output = "export const clientRuntimeMarker = true;";

        await withBundler(
          {
            bundle: () => Promise.resolve(bundleResult(output)),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
            stop() {
              stopCalls++;
              return Promise.resolve();
            },
          },
          async () => {
            assertEquals(
              await generateClientModule({ forceSourceBundle: true }),
              output,
            );
          },
        );

        assertEquals(stopCalls, 0);
      });

      it("rejects internal aliases that traverse outside the package root", async () => {
        const bundler: Bundler = {
          async bundle(options) {
            const resolver = options.plugins?.find((plugin) =>
              plugin.name === "veryfront-path-resolver"
            );
            if (!resolver) throw new Error("Path resolver plugin was not registered");

            let resolveCallback: Parameters<BundlerPluginBuild["onResolve"]>[1] | undefined;
            const buildApi: BundlerPluginBuild = {
              onResolve(_options, callback) {
                resolveCallback = callback;
              },
              onLoad() {},
              onDispose() {},
            };
            await resolver.setup(buildApi);
            if (!resolveCallback) throw new Error("Path resolver callback was not registered");

            await resolveCallback({
              path: "#veryfront/../../CLIENT_RUNTIME_OUTSIDE_MARKER.ts",
              importer: "",
              namespace: "file",
              resolveDir: "",
              kind: "import-statement",
            });
            return bundleResult("export const unexpected = true;");
          },
          transform: () => Promise.resolve({ code: "", warnings: [] }),
        };

        await withBundler(bundler, async () => {
          await assertRejects(
            () => generateClientModule({ forceSourceBundle: true }),
            Error,
            "escaped the framework package root",
          );
        });
      });

      it("rejects invalid UTF-8 instead of delegating failed reads to another loader", async () => {
        const testDirectory = await Deno.makeTempDir({
          dir: fromFileUrl(new URL(".", import.meta.url)),
          prefix: ".client-runtime-test-",
        });
        const invalidSourcePath = `${testDirectory}/invalid.ts`;
        await Deno.writeFile(invalidSourcePath, new Uint8Array([0xff]));

        const bundler: Bundler = {
          async bundle(options) {
            const loader = options.plugins?.find((plugin) => plugin.name === "veryfront-fs-loader");
            if (!loader) throw new Error("Filesystem loader plugin was not registered");

            let loadCallback: Parameters<BundlerPluginBuild["onLoad"]>[1] | undefined;
            const buildApi: BundlerPluginBuild = {
              onResolve() {},
              onLoad(_options, callback) {
                loadCallback = callback;
              },
              onDispose() {},
            };
            await loader.setup(buildApi);
            if (!loadCallback) throw new Error("Filesystem loader callback was not registered");

            await loadCallback({
              path: invalidSourcePath,
              namespace: "file",
            });
            return bundleResult("export const unexpected = true;");
          },
          transform: () => Promise.resolve({ code: "", warnings: [] }),
        };

        try {
          await withBundler(bundler, async () => {
            await assertRejects(
              () => generateClientModule({ forceSourceBundle: true }),
              Error,
              "not valid UTF-8",
            );
          });
        } finally {
          await Deno.remove(testDirectory, { recursive: true });
        }
      });

      it("rejects a successful bundler response containing diagnostics", async () => {
        const result = bundleResult("export const unexpected = true;");
        result.errors.push({ text: "synthetic bundler error" });

        await withBundler(
          {
            bundle: () => Promise.resolve(result),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule({ forceSourceBundle: true }),
              Error,
              "reported errors",
            );
            assertStringIncludes(String(error), "../../rendering/client/router.ts");
          },
        );
      });

      it("rejects ambiguous multi-file output", async () => {
        const result = bundleResult("export const first = true;");
        result.outputFiles.push(
          bundleResult("export const second = true;").outputFiles[0]!,
        );

        await withBundler(
          {
            bundle: () => Promise.resolve(result),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            await assertRejects(
              () => generateClientModule({ forceSourceBundle: true }),
              Error,
              "Expected one bundled output",
            );
          },
        );
      });

      it("rejects generated output containing an unresolved internal specifier", async () => {
        await withBundler(
          {
            bundle: () =>
              Promise.resolve(
                bundleResult('export { boot } from "@vf-src/rendering/client/router.ts";'),
              ),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            await assertRejects(
              () => generateClientModule({ forceSourceBundle: true }),
              Error,
              "contains unresolved internal imports",
            );
          },
        );
      });
    });

    describe(
      "generateRouterScript",
      { sanitizeOps: false, sanitizeResources: false },
      () => {
        let result: string;

        beforeAll(async () => {
          // deno-lint-ignore no-explicit-any
          result = await generateRouterScript(null as any);
        });

        it("should return the same output as generateClientModule", async () => {
          const clientResult = await generateClientModule();
          assertEquals(result, clientResult);
        });

        it("should not emit unresolved internal aliases", () => {
          assertEquals(
            result.includes("#veryfront/"),
            false,
            "router runtime bundle should resolve internal aliases before browser delivery",
          );
        });
      },
    );

    describe(
      "generatePrefetchScript",
      { sanitizeOps: false, sanitizeResources: false },
      () => {
        let result: string;

        beforeAll(async () => {
          // deno-lint-ignore no-explicit-any
          result = await generatePrefetchScript(null as any);
        });

        it("should return a non-empty string", () => {
          assertEquals(typeof result, "string");
          assertEquals(result.length > 0, true);
        });

        it("should produce ESM output", () => {
          assertEquals(
            result.includes("import") || result.includes("export"),
            true,
            "bundled output should contain ESM syntax",
          );
        });

        it("should contain prefetch logic", () => {
          assertEquals(
            result.includes("PrefetchManager"),
            true,
            "bundled output should contain PrefetchManager class",
          );
        });

        it("should be different from the router bundle", async () => {
          const routerResult = await generateClientModule();
          assertEquals(
            result !== routerResult,
            true,
            "prefetch script should differ from router script",
          );
        });

        it("should match a freshly generated source bundle", async () => {
          // deno-lint-ignore no-explicit-any
          const sourceBundle = await generatePrefetchScript(null as any, {
            forceSourceBundle: true,
          });
          assertEquals(
            result,
            sourceBundle,
            "embedded prefetch bundle should match source generation output",
          );
        });
      },
    );

    describe("generateImportMap", () => {
      it("should return an HTML script tag with importmap", async () => {
        const importMap = await generateImportMap();
        assertEquals(importMap.includes('<script type="importmap">'), true);
        assertEquals(importMap.includes("</script>"), true);
      });

      it("should contain react in the import map", async () => {
        const importMap = await generateImportMap();
        assertEquals(importMap.includes("react"), true);
      });

      it("should contain valid JSON inside the script tag", async () => {
        const importMap = await generateImportMap();
        const jsonMatch = importMap.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
        assertEquals(jsonMatch !== null, true);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]!);
          assertEquals(typeof parsed.imports, "object");
        }
      });
    });

    describe("generateAppModule edge cases", () => {
      it("should include IIFE wrapper", () => {
        const result = generateAppModule();
        assertEquals(result.includes("(() => {"), true);
        assertEquals(result.includes("})()"), true);
      });

      it("should include hydration support", () => {
        const result = generateAppModule();
        assertEquals(result.includes("window.hydrate"), true);
        assertEquals(result.includes("async function"), true);
      });
    });
  },
);
