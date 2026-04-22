/**
 * ext-node-compat extension tests.
 *
 * Exercises the extension factory lifecycle and `NodeCompatImpl` stub
 * behaviour — does not actually load `@kreuzberg/wasm` or `better-sqlite3`
 * so the suite runs without those native deps being installed.
 *
 * @module extensions/ext-node-compat/test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import factory, { NodeCompatImpl } from "./index.ts";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function silentLogger(): ExtensionLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function buildCtx(
  provides: Map<string, unknown>,
  logger: ExtensionLogger = silentLogger(),
): ExtensionContext {
  return {
    get: <T>(name: string) => provides.get(name) as T | undefined,
    require: <T>(name: string) => {
      const impl = provides.get(name);
      if (impl === undefined) throw new Error(`missing ${name}`);
      return impl as T;
    },
    provide: <T>(name: string, impl: T) => {
      provides.set(name, impl);
    },
    config: {},
    logger,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ext-node-compat extension", () => {
  describe("factory metadata", () => {
    it("declares the expected name and version", () => {
      const ext = factory();
      assertEquals(ext.name, "ext-node-compat");
      assertEquals(typeof ext.version, "string");
      assertEquals(ext.version.length > 0, true);
    });

    it("declares a NodeCompat contract capability", () => {
      const ext = factory();
      const hasContract = ext.capabilities.some(
        (c) => c.type === "contract" && c.name === "NodeCompat",
      );
      assertEquals(hasContract, true);
    });
  });

  describe("setup / teardown lifecycle", () => {
    it("registers NodeCompat on setup", () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const ctx = buildCtx(provides);

      ext.setup!(ctx as never);
      assertEquals(provides.has("NodeCompat"), true);
    });

    it("registered impl exposes importKreuzberg and openSqliteDatabase", () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const ctx = buildCtx(provides);

      ext.setup!(ctx as never);

      const impl = provides.get("NodeCompat") as NodeCompatImpl;
      assertExists(impl);
      assertEquals(typeof impl.importKreuzberg, "function");
      assertEquals(typeof impl.openSqliteDatabase, "function");
    });

    it("teardown is a no-op (returns undefined)", () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const ctx = buildCtx(provides);
      ext.setup!(ctx as never);
      // teardown is optional and not defined on this extension
      assertEquals(ext.teardown, undefined);
    });
  });
});
