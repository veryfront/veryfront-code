/**
 * Tests for the contract registry.
 *
 * @module extensions/contracts.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, resolve, tryResolve } from "./contracts.ts";

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

    it("includes recommendation in error message when available", () => {
      assertThrows(
        () => resolve("Bundler"),
        Error,
        "deno add @veryfront/ext-bundler-esbuild",
      );
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
