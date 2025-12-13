import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("agent types", () => {
  it("should export type definitions", async () => {
    const module = await import("./agent.ts");
    // Just verify module loads and types are available at runtime
    assert(typeof module === "object");
  });
});
