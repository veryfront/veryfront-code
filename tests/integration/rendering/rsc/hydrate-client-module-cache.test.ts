import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { importClientModule, parseClientRef } from "#veryfront/rendering/rsc/hydrate-client.ts";

// importClientModule memoizes resolved client modules on the global
// __VF_CLIENT_MOD_CACHE map, so exercising the cache is a host effect and
// belongs here rather than in the colocated unit test.
describe("rendering/rsc/hydrate-client module cache", () => {
  afterEach(() => {
    delete (globalThis as unknown as { __VF_CLIENT_MOD_CACHE?: unknown }).__VF_CLIENT_MOD_CACHE;
  });

  it("reuses cached client modules per manifest hash", async () => {
    const reference = parseClientRef(
      "/_veryfront/rsc/module?rel=app%2FCachedCounter.tsx#default",
    )!;
    const moduleA = { id: "a", default: () => null };
    const moduleB = { id: "b", default: () => null };
    let imports = 0;
    const importWithHash = (hash: string, mod: typeof moduleA) =>
      importClientModule({ version: 1, hash, modules: [] }, reference, "rsc-module", {
        importModule: () => {
          imports++;
          return Promise.resolve(mod);
        },
      });

    assertEquals(await importWithHash("a", moduleA), moduleA, "the first import resolves");
    assertEquals(
      await importWithHash("a", moduleB),
      moduleA,
      "same manifest hash must hit the module cache",
    );
    assertEquals(imports, 1, "same manifest hash must not import the module twice");
    assertEquals(
      await importWithHash("b", moduleB),
      moduleB,
      "a manifest hash change must bypass the cached module",
    );
    assertEquals(imports, 2, "a manifest hash change must import the module again");
  });
});
