import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDenoEnvShim } from "./deno-env.ts";

// deno-env.ts is a shim that populates globalThis.Deno.env when missing.
// In Deno runtime, Deno.env already exists, so we test the real Deno.env behavior
// which matches the shim contract.

describe("platform/compat/shims/deno-env", () => {
  it("filters undefined values from the object snapshot", () => {
    const source: Record<string, string | undefined> = {
      PRESENT: "value",
      MISSING: undefined,
    };
    const env = createDenoEnvShim(source);

    assertEquals(env.has("MISSING"), false);
    assertEquals(env.toObject(), { PRESENT: "value" });
  });

  describe("createDenoEnvShim", () => {
    it("reads, writes and deletes through the backing record", () => {
      const source: Record<string, string | undefined> = { A: "1" };
      const env = createDenoEnvShim(source);

      assertEquals(env.get("A"), "1", "get must read the backing record");
      env.set("B", "2");
      assertEquals(env.get("B"), "2", "set must write through to the backing record");
      assertEquals(source.B, "2", "set must mutate the caller's record");
      assertEquals(env.has("B"), true, "has must report a set key");
      env.delete("B");
      assertEquals(env.get("B"), undefined, "delete must remove the key");
      assertEquals(env.has("B"), false, "has must report a deleted key as absent");
      assertEquals("B" in source, false, "delete must remove the key from the caller's record");
      assertEquals(env.toObject(), { A: "1" }, "toObject must reflect set and delete");
    });
  });

  // Parity check only: under Deno this block exercises the runtime's own
  // Deno.env, not the shim, because the shim never replaces an existing global.
  describe("Deno.env.get/set/delete/has/toObject", () => {
    const testKey = "__VF_TEST_DENO_ENV_SHIM__";

    it("does not rely on TypeScript ignore comments for the shim global", async () => {
      const source = await Deno.readTextFile(new URL("./deno-env.ts", import.meta.url));
      assertEquals(source.includes("@ts-ignore"), false);
    });

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
