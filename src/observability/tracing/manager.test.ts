import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("tracing/manager", () => {
  it("should exist and be importable", async () => {
    const module = await import("./manager.ts");
    assertEquals(typeof module, "object");
    assertExists(module.tracingManager);
  });
});
