import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type {
  Bundler,
  BundleResult,
  BundlerPluginBuild,
  ImportSpecifier,
  ModuleLexer,
} from "veryfront/extensions/bundler";
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

function importSpecifier(overrides: Partial<ImportSpecifier> = {}): ImportSpecifier {
  return {
    n: "react",
    s: 8,
    e: 13,
    ss: 0,
    se: 14,
    d: -1,
    a: -1,
    ...overrides,
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

async function withModuleLexer<T>(
  lexer: ModuleLexer | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tryResolve<ModuleLexer>("ModuleLexer");
  unregister("ModuleLexer");
  if (lexer !== undefined) register("ModuleLexer", lexer);
  try {
    return await operation();
  } finally {
    unregister("ModuleLexer");
    if (previous !== undefined) register("ModuleLexer", previous);
  }
}

const EXPECTED_CLIENT_EXTERNALS = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

async function assertBrowserBundleImportsAreSupported(source: string): Promise<void> {
  const lexer = tryResolve<ModuleLexer>("ModuleLexer");
  if (!lexer) throw new Error("The test ModuleLexer contract is not registered");
  await lexer.init?.();
  const imports = lexer.parse(source);
  assertEquals(
    imports.filter((specifier) => specifier.d >= 0 && specifier.n === undefined).length,
    0,
    "client bundles must not defer an unauditable computed import to the browser",
  );
  assertEquals(
    imports
      .filter((specifier) => specifier.n !== undefined)
      .map((specifier) => specifier.n!)
      .filter((specifier) => !EXPECTED_CLIENT_EXTERNALS.has(specifier)),
    [],
    "client bundles must contain only the external modules provided by the generated import map",
  );
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

        it("emits only browser-supported external imports", async () => {
          await assertBrowserBundleImportsAreSupported(result);
        });

        it("should match a freshly generated source bundle", async () => {
          const sourceBundle = await generateClientModule({ forceSourceBundle: true });
          await assertBrowserBundleImportsAreSupported(sourceBundle);
          assertEquals(
            result,
            sourceBundle,
            "embedded router bundle should match source generation output",
          );
        });
      },
    );

    describe("source bundle safety", () => {
      it("bundles the real router graph without server-runtime imports", async () => {
        const output = await generateClientModule({ forceSourceBundle: true });
        await assertBrowserBundleImportsAreSupported(output);
      });

      it("reads framework sources through the exact bounded reader", async () => {
        const originalReadFile = Deno.readFile;
        let wholeFileReads = 0;
        Deno.readFile = () => {
          wholeFileReads++;
          return Promise.reject(new Error("whole-file source reads are forbidden"));
        };
        try {
          await withBundler(
            {
              bundle: () => Promise.resolve(bundleResult("export const boundedSource = true;")),
              transform: () => Promise.resolve({ code: "", warnings: [] }),
            },
            async () => {
              assertEquals(
                await generateClientModule({ forceSourceBundle: true }),
                "export const boundedSource = true;",
              );
            },
          );
        } finally {
          Deno.readFile = originalReadFile;
        }

        assertEquals(wholeFileReads, 0);
      });

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
              "unsupported external import",
            );
          },
        );
      });

      for (
        const specifier of [
          "node:fs",
          "deno:land",
          "bun:test",
          "file:///tmp/runtime.mjs",
          "npm:package",
          "jsr:@scope/package",
        ]
      ) {
        it(`rejects the browser-incompatible ${specifier} protocol`, async () => {
          await withBundler(
            {
              bundle: () => Promise.resolve(bundleResult(`import ${JSON.stringify(specifier)};`)),
              transform: () => Promise.resolve({ code: "", warnings: [] }),
            },
            async () => {
              await assertRejects(
                () => generateClientModule({ forceSourceBundle: true }),
                Error,
                "unsupported external import",
              );
            },
          );
        });
      }

      it("rejects an undeclared bare package import", async () => {
        await withBundler(
          {
            bundle: () => Promise.resolve(bundleResult('import "left-pad";')),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            await assertRejects(
              () => generateClientModule({ forceSourceBundle: true }),
              Error,
              "unsupported external import",
            );
          },
        );
      });

      it("rejects a computed dynamic import whose target cannot be audited", async () => {
        await withBundler(
          {
            bundle: () =>
              Promise.resolve(
                bundleResult('const target = "node:fs"; export const pending = import(target);'),
              ),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            await assertRejects(
              () => generateClientModule({ forceSourceBundle: true }),
              Error,
              "computed dynamic import",
            );
          },
        );
      });

      it("accepts supported externals and import.meta", async () => {
        const output = [
          'import ReactDOM from "react-dom/client";',
          "export const moduleUrl = import.meta.url;",
          'export const lazyReact = import("react");',
          "export { ReactDOM };",
        ].join("\n");
        await withBundler(
          {
            bundle: () => Promise.resolve(bundleResult(output)),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            assertEquals(await generateClientModule({ forceSourceBundle: true }), output);
          },
        );
      });

      it("does not mistake protocol text in strings or comments for an import", async () => {
        const output = [
          '// import "node:fs" is documentation, not executable syntax',
          'export const example = "deno:land";',
        ].join("\n");
        await withBundler(
          {
            bundle: () => Promise.resolve(bundleResult(output)),
            transform: () => Promise.resolve({ code: "", warnings: [] }),
          },
          async () => {
            assertEquals(await generateClientModule({ forceSourceBundle: true }), output);
          },
        );
      });

      it("fails closed when no ModuleLexer extension is registered", async () => {
        await withModuleLexer(undefined, async () => {
          await assertRejects(
            () => generateClientModule(),
            Error,
            "ModuleLexer",
          );
        });
      });

      it("preserves a ModuleLexer initialization failure as the build cause", async () => {
        const sentinel = new Error("module lexer initialization sentinel");
        await withModuleLexer(
          {
            init: () => Promise.reject(sentinel),
            parse: () => [],
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            );
            assertStrictEquals((error as Error & { cause?: unknown }).cause, sentinel);
          },
        );
      });

      it("preserves a ModuleLexer parse failure as the build cause", async () => {
        const sentinel = new Error("module lexer parse sentinel");
        await withModuleLexer(
          {
            parse(): never {
              throw sentinel;
            },
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            );
            assertStrictEquals((error as Error & { cause?: unknown }).cause, sentinel);
          },
        );
      });

      it("rejects a contradictory import.meta record as malformed lexer output", async () => {
        await withModuleLexer(
          {
            parse: () => [
              importSpecifier({
                n: "node:fs",
                s: 0,
                e: 11,
                ss: 0,
                se: 11,
                d: -2,
              }),
            ],
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            ) as Error & { cause?: unknown; slug?: string };
            assertEquals(error.slug, "build-failed");
            assertEquals(error.cause instanceof TypeError, true);
          },
        );
      });

      it("wraps a non-array ModuleLexer result as a build failure", async () => {
        await withModuleLexer(
          {
            parse: () => ({}) as never,
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            ) as Error & { cause?: unknown; slug?: string };
            assertEquals(error.slug, "build-failed");
            assertEquals(error.cause instanceof TypeError, true);
          },
        );
      });

      it("preserves a ModuleLexer iterator failure as the build cause", async () => {
        const sentinel = new Error("module lexer iterator sentinel");
        const imports = [importSpecifier()];
        Object.defineProperty(imports, Symbol.iterator, {
          get(): never {
            throw sentinel;
          },
        });

        await withModuleLexer(
          { parse: () => imports },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            ) as Error & { cause?: unknown; slug?: string };
            assertEquals(error.slug, "build-failed");
            assertStrictEquals(error.cause, sentinel);
          },
        );
      });

      it("preserves a ModuleLexer record failure as the build cause", async () => {
        const sentinel = new Error("module lexer record sentinel");
        const imported = Object.defineProperty(importSpecifier(), "d", {
          get(): never {
            throw sentinel;
          },
        });

        await withModuleLexer(
          { parse: () => [imported] },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            ) as Error & { cause?: unknown; slug?: string };
            assertEquals(error.slug, "build-failed");
            assertStrictEquals(error.cause, sentinel);
          },
        );
      });

      for (const field of ["s", "e", "ss", "se", "d", "a"] as const) {
        it(`rejects a non-integer ${field} position in ModuleLexer output`, async () => {
          await withModuleLexer(
            {
              parse: () => [importSpecifier({ [field]: Number.NaN })],
            },
            async () => {
              const error = await assertRejects(
                () => generateClientModule(),
                Error,
                "could not be inspected",
              ) as Error & { cause?: unknown; slug?: string };
              assertEquals(error.slug, "build-failed");
              assertEquals(error.cause instanceof TypeError, true);
            },
          );
        });
      }

      for (
        const malformed of [
          { name: "negative specifier start", record: { s: -1 } },
          { name: "specifier end before its start", record: { e: 7 } },
          { name: "statement start after the specifier start", record: { ss: 9 } },
          { name: "statement end before the specifier end", record: { se: 12 } },
          { name: "unknown negative dynamic-import marker", record: { d: -3 } },
          { name: "attribute start before the specifier end", record: { a: 7 } },
        ] as const
      ) {
        it(`rejects ${malformed.name} in ModuleLexer output`, async () => {
          await withModuleLexer(
            {
              parse: () => [importSpecifier(malformed.record)],
            },
            async () => {
              const error = await assertRejects(
                () => generateClientModule(),
                Error,
                "could not be inspected",
              ) as Error & { cause?: unknown; slug?: string };
              assertEquals(error.slug, "build-failed");
              assertEquals(error.cause instanceof TypeError, true);
            },
          );
        });
      }

      it("rejects an unresolved static import record as malformed lexer output", async () => {
        await withModuleLexer(
          {
            parse: () => [importSpecifier({ n: undefined, d: -1 })],
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            ) as Error & { cause?: unknown; slug?: string };
            assertEquals(error.slug, "build-failed");
            assertEquals(error.cause instanceof TypeError, true);
          },
        );
      });

      it("rejects a non-string resolved specifier in ModuleLexer output", async () => {
        await withModuleLexer(
          {
            parse: () => [importSpecifier({ n: 42 as unknown as string })],
          },
          async () => {
            const error = await assertRejects(
              () => generateClientModule(),
              Error,
              "could not be inspected",
            ) as Error & { cause?: unknown; slug?: string };
            assertEquals(error.slug, "build-failed");
            assertEquals(error.cause instanceof TypeError, true);
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

        it("emits only browser-supported external imports", async () => {
          await assertBrowserBundleImportsAreSupported(result);
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

        it("emits only browser-supported external imports", async () => {
          await assertBrowserBundleImportsAreSupported(result);
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
          await assertBrowserBundleImportsAreSupported(sourceBundle);
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
