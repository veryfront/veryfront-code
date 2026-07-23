import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the contract registry.
 *
 * @module extensions/contracts.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, resolve, tryResolve, unregister } from "./contracts.ts";
import * as publicContracts from "veryfront/extensions/contracts";

describe("extensions/contracts", () => {
  afterEach(() => {
    reset();
  });

  it("keeps lifecycle snapshots out of the public contract registry surface", () => {
    assertEquals(Object.keys(publicContracts).sort(), [
      "register",
      "reset",
      "resolve",
      "tryResolve",
      "unregister",
    ]);
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

    it("rejects invalid names and undefined implementations", () => {
      for (const name of ["", " Contract", "Contract\nName", "x".repeat(129)]) {
        assertThrows(() => register(name, {}), Error, "Contract name");
      }
      assertThrows(
        () => register("UndefinedContract", undefined),
        Error,
        "implementation cannot be undefined",
      );
    });

    it("bounds process-wide contract registrations without blocking replacement", () => {
      reset();
      for (let index = 0; index < 4_096; index++) {
        register(`Contract${index}`, index);
      }

      assertThrows(
        () => register("ContractOverflow", {}),
        Error,
        "at most 4096",
      );
      register("Contract0", "replacement");
      assertEquals(resolve("Contract0"), "replacement");
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
