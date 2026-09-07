import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadModule, type ModuleLoaderConfig } from "./index.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";

describe("prepared data modules", () => {
  for (const settlement of ["resolve", "reject"] as const) {
    it(`cancels a stalled import before its late ${settlement}`, async () => {
      const adapter = createMockAdapter();
      const pending = Promise.withResolvers<Record<string, unknown>>();
      const started = Promise.withResolvers<void>();
      const controller = new AbortController();
      const progress: string[] = [];
      Object.defineProperty(adapter, "moduleLoader", {
        value: {
          importModule: () => {
            started.resolve();
            return pending.promise;
          },
        },
      });
      const config = {
        adapter,
        signal: controller.signal,
        onProgress: ({ phase }: { phase: string }) => progress.push(phase),
      } as unknown as ModuleLoaderConfig;
      const outcome = loadModule("/project/page.tsx", config).then(
        () => undefined,
        (error: unknown) => error,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await started.promise;
        const reason = new Error("module-load deadline expired");
        controller.abort(reason);
        const observed = await Promise.race([
          outcome,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 0);
          }),
        ]);
        assertStrictEquals(observed, reason, "cancellation must not wait for the import");
        assertEquals(progress, ["module:import-start"]);
      } finally {
        clearTimeout(timer);
        if (settlement === "resolve") pending.resolve({ getServerData: () => ({ props: {} }) });
        else pending.reject(new Error("late import failure"));
        await outcome;
      }
      assertEquals(progress, ["module:import-start"], "late completion must not report success");
    });
  }

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
