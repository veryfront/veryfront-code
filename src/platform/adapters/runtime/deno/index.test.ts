import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DenoAdapter, denoAdapter } from "./index.ts";

describe("runtime/deno/index.ts exports", () => {
  it("should export DenoAdapter class", () => {
    assertExists(DenoAdapter);
    assertEquals(typeof DenoAdapter, "function");
  });

  it("should export denoAdapter singleton", () => {
    assertExists(denoAdapter);
    assertEquals(denoAdapter.id, "deno");
    assertEquals(denoAdapter.name, "deno");
  });
});
