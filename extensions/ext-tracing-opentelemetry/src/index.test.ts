/**
 * ext-tracing-opentelemetry extension tests.
 *
 * @module extensions/ext-tracing-opentelemetry/test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import factory from "./index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("ext-tracing-opentelemetry factory", () => {
  it("produces an Extension with name ext-tracing-opentelemetry", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-tracing-opentelemetry");
    assertEquals(ext.version, "0.1.0");
    assertEquals(Array.isArray(ext.capabilities), true);
    assertEquals(
      ext.capabilities.some((c) => c.type === "contract" && c.name === "TracingExporter"),
      true,
    );
  });
});

describe("ext-tracing-opentelemetry TracingExporter", () => {
  it("registers TracingExporter on setup", async () => {
    const provided = new Map<string, unknown>();

    const ctx = {
      config: {},
      logger: noopLogger,
      provide: (name: string, impl: unknown) => provided.set(name, impl),
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
    };

    const ext = factory();
    // deno-lint-ignore no-explicit-any
    await ext.setup?.(ctx as any);

    assertEquals(provided.has("TracingExporter"), true);

    const exporter = provided.get("TracingExporter") as {
      getProvider: () => unknown;
      shutdown: () => Promise<void>;
      export: (spans: unknown[]) => Promise<void>;
      start: (cfg: unknown) => Promise<void>;
    };

    assertExists(exporter);
    assertEquals(typeof exporter.getProvider, "function");
    assertEquals(typeof exporter.shutdown, "function");
    assertEquals(typeof exporter.export, "function");

    // getProvider() must return a non-null TracerProvider
    const provider = exporter.getProvider();
    assertExists(provider);
    assertEquals(typeof (provider as { getTracer?: unknown }).getTracer, "function");

    await ext.teardown?.();
  });

  it("export() is a no-op (BatchSpanProcessor handles export)", async () => {
    const provided = new Map<string, unknown>();
    const ctx = {
      config: {},
      logger: noopLogger,
      provide: (name: string, impl: unknown) => provided.set(name, impl),
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
    };

    const ext = factory();
    // deno-lint-ignore no-explicit-any
    await ext.setup?.(ctx as any);

    const exporter = provided.get("TracingExporter") as {
      export: (spans: unknown[]) => Promise<void>;
      shutdown: () => Promise<void>;
    };

    // Should not throw
    await exporter.export([]);
    await exporter.shutdown();
  });

  it("teardown() shuts down without error when called without setup", async () => {
    const ext = factory();
    // Should not throw
    await ext.teardown?.();
  });
});
