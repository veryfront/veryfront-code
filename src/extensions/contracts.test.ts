import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the contract registry.
 *
 * @module extensions/contracts.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
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
      assertThrows(
        () => resolve("UnknownContract"),
        Error,
        'Missing extension for contract "UnknownContract"',
      );
    });

    it("includes an executable npm recommendation in the error", () => {
      const error = assertThrows(
        () => resolve("IsolatedSsrRendererProvider"),
        VeryfrontError,
        "deno add npm:@veryfront/ext-react-ssr",
      );
      assertEquals(
        error.detail,
        "Install it with: deno add npm:@veryfront/ext-react-ssr",
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
