import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("tracing/context-propagation", () => {
  it("should exist and be importable", async () => {
    const module = await import("./context-propagation.ts");
    assertEquals(typeof module, "object");
    assertExists(module.ContextPropagation);
  });
});
