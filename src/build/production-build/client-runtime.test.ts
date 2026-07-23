import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { VERSION } from "#veryfront/utils/version.ts";
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

      it("uses the canonical runtime version", () => {
        const result = getResult();
        assertEquals(result.includes("export const version"), true);
        assertEquals(result.includes(JSON.stringify(VERSION)), true);
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

      it("delegates hydration to the canonical client runtime", () => {
        const result = getResult();
        assertEquals(result.includes('import { boot } from "./client.js"'), true);
        assertEquals(result.includes("data-hydrated"), false);
        assertEquals(result.includes("getElementById('root')"), false);
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
      it("should not include a separate IIFE runtime", () => {
        const result = generateAppModule();
        assertEquals(result.includes("(() => {"), false);
      });

      it("should include hydration support", () => {
        const result = generateAppModule();
        assertEquals(result.includes("window.hydrate"), true);
        assertEquals(result.includes("async function"), true);
      });
    });
  },
);
