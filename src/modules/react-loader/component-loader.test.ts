import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadComponentFromSource, loadModuleFromSource } from "./component-loader.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import {
  getGlobalTracerProvider,
  setGlobalTracerProvider,
  type SpanStartOptions,
} from "#veryfront/observability/tracing/api-shim.ts";

describe("prepared component modules", () => {
  it("cancels a stalled prepared component import", async () => {
    const adapter = createMockAdapter();
    const started = Promise.withResolvers<void>();
    const deferred = Promise.withResolvers<Record<string, unknown>>();
    const controller = new AbortController();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: () => {
          started.resolve();
          return deferred.promise;
        },
      },
    });
    const outcome = loadModuleFromSource("", "/project/page.tsx", "/project", adapter, {
      dev: false,
      signal: controller.signal,
    }).then(() => undefined, (error: unknown) => error);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await started.promise;
      const reason = new Error("render cancelled");
      controller.abort(reason);
      const observed = await Promise.race([
        outcome,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 0);
        }),
      ]);
      assertStrictEquals(observed, reason, "component cancellation must not wait for the producer");
    } finally {
      clearTimeout(timer);
      deferred.resolve({});
      await outcome;
    }
  });

  it("records prepared imports in the component load span", async () => {
    const previous = getGlobalTracerProvider();
    const started: { name: string; options?: SpanStartOptions }[] = [];
    setGlobalTracerProvider({
      getTracer: (...args) => {
        const tracer = previous.getTracer(...args);
        return {
          startSpan: (name, options, parent) => {
            started.push({ name, options });
            return tracer.startSpan(name, options, parent);
          },
          startActiveSpan: tracer.startActiveSpan.bind(tracer),
        };
      },
    });
    try {
      const adapter = createMockAdapter();
      Object.defineProperty(adapter, "moduleLoader", {
        value: { importModule: async () => ({ value: 42 }) },
      });
      assertEquals(
        await loadModuleFromSource("unused", "/project/page.tsx", "/project", adapter, {
          dev: false,
        }),
        { value: 42 },
      );
      const load = started.find((span) => span.name === "modules.react.loadComponentFromSource");
      assertEquals(load?.options?.attributes?.["react.prepared"], true);
      assertEquals(load?.options?.attributes?.["react.ssr"], true);
    } finally {
      setGlobalTracerProvider(previous);
    }
  });

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
