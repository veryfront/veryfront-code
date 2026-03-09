import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "esbuild";
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
      if ((globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) return;
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
          (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild = true;
          result = await generateClientModule();
        });

        afterAll(() => {
          delete (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild;
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
      },
    );

    describe(
      "generateRouterScript",
      { sanitizeOps: false, sanitizeResources: false },
      () => {
        let result: string;

        beforeAll(async () => {
          (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild = true;
          // deno-lint-ignore no-explicit-any
          result = await generateRouterScript(null as any);
        });

        afterAll(() => {
          delete (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild;
        });

        it("should return the same output as generateClientModule", async () => {
          const clientResult = await generateClientModule();
          assertEquals(result, clientResult);
        });
      },
    );

    describe(
      "generatePrefetchScript",
      { sanitizeOps: false, sanitizeResources: false },
      () => {
        let result: string;

        beforeAll(async () => {
          (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild = true;
          // deno-lint-ignore no-explicit-any
          result = await generatePrefetchScript(null as any);
        });

        afterAll(() => {
          delete (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild;
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
          const parsed = JSON.parse(jsonMatch[1]);
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
