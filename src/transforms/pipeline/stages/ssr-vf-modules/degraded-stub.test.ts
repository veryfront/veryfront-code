import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildDegradedModuleStub, extractExportNames } from "./transform.ts";

// Fix B: when a relative framework dependency cannot be transformed (e.g. a
// server-only adapter whose npm package will not bundle for the browser), the
// catch writes a lazily-throwing stub carrying the module's real export names
// instead of leaving a dangling relative import. Importing the stub must
// succeed; only actually calling a stubbed symbol at runtime throws. This keeps
// one un-bundleable optional dependency from 500ing every route that
// transitively imports the framework barrel.
describe("ssr-vf-modules degraded stub", () => {
  const SOURCE = `export function getRedisModule(){}\nexport function clearModuleCache(){}`;

  describe("extractExportNames", () => {
    it("finds every named export the source declares", () => {
      const { named, hasDefault } = extractExportNames(SOURCE);
      assertEquals([...named].sort(), ["clearModuleCache", "getRedisModule"]);
      assertEquals(hasDefault, false);
    });

    it("recognises a default export", () => {
      const { hasDefault } = extractExportNames(
        `export default function Page(){}\nexport const a = 1;`,
      );
      assertEquals(hasDefault, true);
    });
  });

  describe("buildDegradedModuleStub", () => {
    it("carries the same named exports, each throwing only when called, and imports cleanly", async () => {
      const stub = buildDegradedModuleStub(
        SOURCE,
        "/framework/src/redis/module-cache.ts",
        "esm.sh build failed",
      );

      // The stub re-declares the source's named exports.
      assertStringIncludes(stub, "export function getRedisModule(");
      assertStringIncludes(stub, "export function clearModuleCache(");

      // Importing the stub must not throw — it is a shape-compatible module.
      const tmp = await Deno.makeTempFile({ suffix: ".mjs" });
      await Deno.writeTextFile(tmp, stub);
      try {
        const mod = await import(`file://${tmp}`);

        assertEquals(typeof mod.getRedisModule, "function");
        assertEquals(typeof mod.clearModuleCache, "function");

        // Each symbol throws lazily, only when actually invoked.
        assertThrows(() => mod.getRedisModule(), Error);
        assertThrows(() => mod.clearModuleCache(), Error);

        // The thrown error names the symbol that was unavailable.
        const capture = (fn: () => unknown): Error => {
          try {
            fn();
          } catch (error) {
            return error as Error;
          }
          throw new Error("expected the stubbed symbol to throw");
        };
        assertStringIncludes(capture(() => mod.getRedisModule()).message, "getRedisModule");
        assertStringIncludes(capture(() => mod.clearModuleCache()).message, "clearModuleCache");
      } finally {
        await Deno.remove(tmp);
      }
    });

    it("emits an inert module (export {}) when the source declares no exports", () => {
      const stub = buildDegradedModuleStub("const x = 1;", "/framework/src/empty.ts", "boom");
      assertStringIncludes(stub, "export {};");
      assert(!stub.includes("export function"));
    });
  });
});
