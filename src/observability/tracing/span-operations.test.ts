import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("tracing/span-operations", () => {
  it("should exist and be importable", async () => {
    const module = await import("./span-operations.ts");
    assertEquals(typeof module, "object");
    assertExists(module.SpanOperations);
  });
});
