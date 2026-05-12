/**
 * ext-bundler-esbuild extension scaffold tests.
 *
 * Smoke tests only — the stub Bundler / ModuleLexer methods are NOT
 * exercised here. They throw by design and will be covered by Tasks 4 and 5
 * once the real implementations land.
 *
 * @module extensions/ext-bundler-esbuild/test
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import factory from "./index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("ext-bundler-esbuild factory", () => {
  it("produces an Extension with name ext-bundler-esbuild", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-bundler-esbuild");
    assertEquals(ext.version, "0.1.0");
    assertEquals(Array.isArray(ext.capabilities), true);
    assertEquals(
      ext.capabilities.some((c) => c.type === "contract" && c.name === "Bundler"),
      true,
    );
    assertEquals(
      ext.capabilities.some((c) => c.type === "contract" && c.name === "ModuleLexer"),
      true,
    );
  });
});

describe("ext-bundler-esbuild setup/teardown", () => {
  it("registers Bundler + ModuleLexer on setup", async () => {
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

    assertEquals(provided.size, 2);
    assertEquals(provided.has("Bundler"), true);
    assertEquals(provided.has("ModuleLexer"), true);

    await ext.teardown?.();
  });

  it("skips registration when contracts are already provided", async () => {
    const provided = new Map<string, unknown>();
    const existingBundler = { name: "custom-bundler" };

    const ctx = {
      config: {},
      logger: noopLogger,
      provide: (name: string, impl: unknown) => provided.set(name, impl),
      get: (name: string) => (name === "Bundler" ? existingBundler : undefined),
      require: () => {
        throw new Error("not used");
      },
    };

    const ext = factory();
    // deno-lint-ignore no-explicit-any
    await ext.setup?.(ctx as any);

    assertEquals(provided.has("Bundler"), false);
    assertEquals(provided.has("ModuleLexer"), true);

    await ext.teardown?.();
  });

  it("teardown() completes without error when called without setup", async () => {
    const ext = factory();
    await ext.teardown?.();
  });
});
