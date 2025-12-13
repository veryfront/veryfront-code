import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";

describe("simple-metrics/metrics-recorder", () => {
  it("should exist and be importable", async () => {
    const module = await import("./metrics-recorder.ts");
    assertEquals(typeof module, "object");
  });
});
