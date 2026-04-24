/**
 * ext-esbuild extension scaffold tests.
 *
 * Smoke tests only — the stub Bundler / ModuleLexer methods are NOT
 * exercised here. They throw by design and will be covered by Tasks 4 and 5
 * once the real implementations land.
 *
 * @module extensions/ext-esbuild/test
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

describe("ext-esbuild factory", () => {
  it("produces an Extension with name ext-esbuild", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-esbuild");
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

describe("ext-esbuild setup/teardown", () => {
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

  it("teardown() completes without error when called without setup", async () => {
    const ext = factory();
    await ext.teardown?.();
  });
});
