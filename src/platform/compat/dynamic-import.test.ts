import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDynamicImport, dynamicImport } from "./dynamic-import.ts";

describe("platform/compat/dynamic-import", () => {
  it("should be a function", () => {
    assertEquals(typeof dynamicImport, "function");
  });

  it("should import a built-in module", async () => {
    const mod = await dynamicImport<{ join: (...args: unknown[]) => unknown }>("node:path");
    assertExists(mod);
    assertEquals(typeof mod.join, "function");
  });

  it("should reject for a non-existent module", async () => {
    await assertRejects(
      () => dynamicImport("__nonexistent_module_12345__"),
    );
  });

  it("does not compile the opaque importer until the first call", async () => {
    let compileCalls = 0;
    const importer = createDynamicImport(() => {
      compileCalls++;
      return (specifier: string) => Promise.resolve({ specifier });
    });

    assertEquals(compileCalls, 0);
    assertEquals(await importer("first"), { specifier: "first" });
    assertEquals(await importer("second"), { specifier: "second" });
    assertEquals(compileCalls, 1);
  });

  it("rejects invalid specifiers before compiling dynamic code", async () => {
    let compileCalls = 0;
    const importer = createDynamicImport(() => {
      compileCalls++;
      return () => Promise.resolve({});
    });

    await assertRejects(() => importer(""), TypeError, "non-empty string");
    await assertRejects(() => importer(null as never), TypeError, "non-empty string");
    assertEquals(compileCalls, 0);
  });

  it("can retry after the runtime refuses dynamic code generation", async () => {
    let compileCalls = 0;
    const importer = createDynamicImport(() => {
      compileCalls++;
      if (compileCalls === 1) throw new EvalError("Dynamic code is disabled");
      return (specifier: string) => Promise.resolve(specifier);
    });

    await assertRejects(() => importer("first"), EvalError);
    assertEquals(await importer("second"), "second");
    assertEquals(compileCalls, 2);
  });
});
