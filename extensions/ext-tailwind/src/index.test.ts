/**
 * ext-tailwind extension tests.
 *
 * @module extensions/ext-tailwind/test
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

describe("ext-tailwind factory", () => {
  it("produces an Extension with name ext-tailwind", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-tailwind");
    assertEquals(ext.version, "0.1.0");
    assertEquals(
      ext.capabilities.some((c) => c.type === "contract" && c.name === "CSSProcessor"),
      true,
    );
  });
});

describe("ext-tailwind CSSProcessor", () => {
  it("registers CSSProcessor on setup", async () => {
    const provided = new Map<string, unknown>();
    const ctx = {
      config: {},
      logger: noopLogger,
      provide: (name: string, impl: unknown) => provided.set(name, impl),
      get: () => undefined,
      resolve: () => {
        throw new Error("resolve not used in setup");
      },
    };
    const ext = factory();
    await ext.setup?.(ctx as never);
    assertEquals(provided.has("CSSProcessor"), true);
    await ext.teardown?.();
  });

  it("installs tailwindcss plugin shims on globalThis after setup", async () => {
    const g = globalThis as Record<string, unknown>;
    delete g.__tailwindPluginShim;
    delete g.__tailwindDefaultThemeShim;
    delete g.__tailwindColorsShim;

    const ctx = {
      config: {},
      logger: noopLogger,
      provide: () => {},
      get: () => undefined,
      resolve: () => {
        throw new Error("resolve not used in setup");
      },
    };
    const ext = factory();
    await ext.setup?.(ctx as never);

    assertEquals(typeof g.__tailwindPluginShim, "object");
    assertEquals(typeof g.__tailwindDefaultThemeShim, "object");
    assertEquals(typeof g.__tailwindColorsShim, "object");
  });
});
