import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";

describe("simple-metrics/otel-instruments", () => {
  it("should exist and be importable", async () => {
    const module = await import("./otel-instruments.ts");
    assertEquals(typeof module, "object");
  });
});
