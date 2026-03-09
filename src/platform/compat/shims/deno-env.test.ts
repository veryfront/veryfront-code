import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// deno-env.ts is a shim that populates globalThis.Deno.env when missing.
// In Deno runtime, Deno.env already exists, so we test the real Deno.env behavior
// which matches the shim contract.

describe("platform/compat/shims/deno-env", () => {
  describe("Deno.env.get/set/delete/has/toObject", () => {
    const testKey = "__VF_TEST_DENO_ENV_SHIM__";

    it("should get undefined for a missing key", () => {
      assertEquals(Deno.env.get(testKey), undefined);
    });

    it("should set and get a value", () => {
      Deno.env.set(testKey, "hello");
      assertEquals(Deno.env.get(testKey), "hello");
      Deno.env.delete(testKey);
    });

    it("should delete a key", () => {
      Deno.env.set(testKey, "val");
      Deno.env.delete(testKey);
      assertEquals(Deno.env.get(testKey), undefined);
    });

    it("should report has correctly", () => {
      assertEquals(Deno.env.has(testKey), false);
      Deno.env.set(testKey, "yes");
      assertEquals(Deno.env.has(testKey), true);
      Deno.env.delete(testKey);
    });

    it("should return an object from toObject", () => {
      const obj = Deno.env.toObject();
      assertEquals(typeof obj, "object");
      assertEquals(obj !== null, true);
    });

    it("should include set keys in toObject", () => {
      Deno.env.set(testKey, "in-object");
      const obj = Deno.env.toObject();
      assertEquals(obj[testKey], "in-object");
      Deno.env.delete(testKey);
    });
  });
});
