import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";

describe("simple-metrics/observability-loader", () => {
  it("should exist and be importable", async () => {
    const module = await import("./observability-loader.ts");
    assertEquals(typeof module, "object");
  });
});
