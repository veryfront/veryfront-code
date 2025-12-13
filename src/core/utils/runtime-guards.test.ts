import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  hasDenoRuntime,
  hasNodeProcess,
  hasBunRuntime,
} from "./runtime-guards.ts";

describe("utils/runtime-guards", () => {
  describe("hasDenoRuntime", () => {
    it("should return false for non-objects", () => {
      assertEquals(hasDenoRuntime(null), false);
      assertEquals(hasDenoRuntime(undefined), false);
      assertEquals(hasDenoRuntime(123), false);
      assertEquals(hasDenoRuntime("string"), false);
    });

    it("should return false for empty objects", () => {
      assertEquals(hasDenoRuntime({}), false);
    });

    it("should return true for Deno-like objects", () => {
      const mock = { Deno: { env: { get: () => undefined } } };
      assertEquals(hasDenoRuntime(mock), true);
    });
  });

  describe("hasNodeProcess", () => {
    it("should return false for non-objects", () => {
      assertEquals(hasNodeProcess(null), false);
      assertEquals(hasNodeProcess(undefined), false);
      assertEquals(hasNodeProcess(123), false);
    });

    it("should return false for empty objects", () => {
      assertEquals(hasNodeProcess({}), false);
    });

    it("should return true for Node-like objects", () => {
      const mock = { process: { env: {} } };
      assertEquals(hasNodeProcess(mock), true);
    });
  });

  describe("hasBunRuntime", () => {
    it("should return false for non-objects", () => {
      assertEquals(hasBunRuntime(null), false);
      assertEquals(hasBunRuntime(undefined), false);
      assertEquals(hasBunRuntime(123), false);
    });

    it("should return false for empty objects", () => {
      assertEquals(hasBunRuntime({}), false);
    });

    it("should return true for Bun-like objects", () => {
      const mock = { Bun: { version: "1.0.0" } };
      assertEquals(hasBunRuntime(mock), true);
    });

    it("should return false if Bun is undefined", () => {
      const mock = { Bun: undefined };
      assertEquals(hasBunRuntime(mock), false);
    });
  });
});
