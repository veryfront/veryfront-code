import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadModule, type ModuleLoaderConfig } from "./index.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";

describe("prepared data modules", () => {
  it("imports from the generation before any cache or source lookup", async () => {
    const module = { getServerData: () => ({ props: {} }) };
    const adapter = createMockAdapter();
    const references: RuntimeModuleReference[] = [];
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          references.push(reference);
          return module;
        },
      },
    });
    const config = { adapter } as unknown as ModuleLoaderConfig;
    assertStrictEquals(await loadModule("/project/page.tsx", config), module);
    assertEquals(references, [{ kind: "source", path: "/project/page.tsx" }]);
    const signal = AbortSignal.abort(new Error("request ended"));
    await assertRejects(
      () => loadModule("/project/page.tsx", { ...config, signal }),
      Error,
      "request ended",
    );
    assertEquals(references.length, 1);
  });
});
