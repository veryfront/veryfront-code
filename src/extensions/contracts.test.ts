import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the contract registry.
 *
 * @module extensions/contracts.test
 */

import { VeryfrontError } from "#veryfront/errors/types.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, resolve, tryResolve, unregister } from "./contracts.ts";

describe("extensions/contracts", () => {
  afterEach(() => {
    reset();
  });

  describe("resolve()", () => {
    it("returns registered implementation", () => {
      const impl = { run: () => "ok" };
      register("Bundler", impl);
      assertEquals(resolve("Bundler"), impl);
    });

    it("throws MissingExtensionError for unregistered contract", () => {
      const error = assertThrows(
        () => resolve("UnknownContract"),
        VeryfrontError,
        'Missing extension for contract "UnknownContract"',
        "resolve must raise the registry missing-extension error",
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        "missing-extension",
        "resolve must raise the registry missing-extension error",
      );
      assertEquals(error.status, 500, "missing extension must map to 500");
      assertEquals(
        error.category,
        "RUNTIME",
        "missing extension must stay in the RUNTIME category",
      );
      assertEquals(
        error.detail,
        undefined,
        "a contract without a recommendation must not carry an install detail",
      );
    });

    it("includes recommendation in error message when available", () => {
      const error = assertThrows(
        () => resolve("Bundler"),
        VeryfrontError,
        "deno add @veryfront/ext-bundler-esbuild",
        "a recommended contract must still raise the registry missing-extension error",
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        "missing-extension",
        "a recommended contract must keep the missing-extension slug",
      );
      assertEquals(
        error.detail,
        "Install it with: deno add @veryfront/ext-bundler-esbuild",
        "detail must name the package to install",
      );
    });

    it("recommends first-party asset engine extensions", () => {
      for (
        const [contract, packageName] of [
          ["CSSOptimizationEngine", "@veryfront/ext-css-lightning"],
          ["CSSPurgingEngine", "@veryfront/ext-css-purgecss"],
          ["ImageOptimizationEngine", "@veryfront/ext-image-sharp"],
        ] as const
      ) {
        assertThrows(
          () => resolve(contract),
          Error,
          `deno add ${packageName}`,
        );
      }
    });
  });

  describe("tryResolve()", () => {
    it("returns registered implementation", () => {
      const impl = { query: () => [] };
      register("DatabaseClient", impl);
      assertEquals(tryResolve("DatabaseClient"), impl);
    });

    it("returns undefined for unregistered contract", () => {
      assertEquals(tryResolve("Nonexistent"), undefined);
    });
  });

  describe("register()", () => {
    it("overwrites previous registration", () => {
      register("CSSProcessor", { v: 1 });
      register("CSSProcessor", { v: 2 });
      assertEquals(resolve<{ v: number }>("CSSProcessor").v, 2);
    });

    it("rejects ambiguous names and undefined implementations", () => {
      assertThrows(
        () => register(" Contract", {}),
        TypeError,
        "non-empty canonical string",
      );
      assertThrows(
        () => register("UndefinedContract", undefined),
        TypeError,
        "must not be undefined",
      );
      assertEquals(tryResolve("UndefinedContract"), undefined);
    });
  });

  describe("unregister()", () => {
    it("removes one registration", () => {
      register("Bundler", {});
      register("CacheStore", {});
      unregister("Bundler");
      assertEquals(tryResolve("Bundler"), undefined);
      assertEquals(tryResolve("CacheStore"), {});
    });
  });

  describe("reset()", () => {
    it("clears all registrations", () => {
      register("Bundler", {});
      register("CacheStore", {});
      reset();
      assertEquals(tryResolve("Bundler"), undefined);
      assertEquals(tryResolve("CacheStore"), undefined);
    });
  });
});
