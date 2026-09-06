import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadComponentFromSource, loadModuleFromSource } from "./component-loader.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";

describe("prepared component modules", () => {
  it("uses the adapter's captured module without compiling or evaluating the supplied source", async () => {
    const adapter = createMockAdapter();
    const component = () => null;
    const module = { default: component };
    const imports: RuntimeModuleReference[] = [];
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          imports.push(reference);
          return module;
        },
      },
    });
    const source = 'throw new Error("legacy source evaluated"); export default () => null;';
    const options = { dev: false, projectId: "project", dependencyPinningCacheKey: "off" };
    assertStrictEquals(
      await loadModuleFromSource(source, "/project/page.tsx", "/project", adapter, options),
      module,
    );
    assertStrictEquals(
      await loadComponentFromSource(source, "/project/page.tsx", "/project", adapter, options),
      component,
    );
    assertEquals(imports, [{ kind: "source", path: "/project/page.tsx" }, {
      kind: "source",
      path: "/project/page.tsx",
    }]);
  });

  it("does not fall back when the prepared module rejects", async () => {
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async () => {
          throw new Error("module not prepared");
        },
      },
    });
    await assertRejects(
      () =>
        loadModuleFromSource("export const value = 1;", "/project/page.ts", "/project", adapter, {
          dev: false,
          dependencyPinningCacheKey: "off",
        }),
      Error,
      "module not prepared",
    );
  });
});
