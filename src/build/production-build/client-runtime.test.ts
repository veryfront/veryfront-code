import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import {
  generateAppModule,
  generateClientModule,
  generateImportMap,
  generatePrefetchScript,
  generateRouterScript,
} from "./client-runtime.ts";

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
        assertStringIncludes(
          result,
          "root.setAttribute('data-hydrated', 'true')",
          "app module must mark the root element as hydrated",
        );
        assertStringIncludes(
          result,
          "const root = document.getElementById('root');",
          "app module must resolve the root element before hydrating",
        );
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
      function parseImportMap(importMap: string): { imports: Record<string, string> } {
        const jsonMatch = importMap.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
        assertEquals(jsonMatch !== null, true, "import map must be wrapped in a script tag");
        return JSON.parse(jsonMatch![1]!) as { imports: Record<string, string> };
      }

      it("should return an HTML script tag with importmap", async () => {
        const importMap = await generateImportMap();
        assertEquals(importMap.includes('<script type="importmap">'), true);
        assertEquals(importMap.includes("</script>"), true);
      });

      it("should contain react in the import map", async () => {
        const importMap = await generateImportMap();
        const parsed = parseImportMap(importMap);
        assertEquals(
          parsed.imports,
          getReactImportMap(REACT_DEFAULT_VERSION),
          "import map must be the shared React import map for the default version",
        );
        assertStringIncludes(
          parsed.imports["react"] as string,
          REACT_DEFAULT_VERSION,
          "react specifier pins the configured React version",
        );
      });

      it("should contain valid JSON inside the script tag", async () => {
        const importMap = await generateImportMap();
        const parsed = parseImportMap(importMap);
        assertEquals(
          parsed.imports !== null && typeof parsed.imports === "object",
          true,
          "imports is a non-null object",
        );
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
