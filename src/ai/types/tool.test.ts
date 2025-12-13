import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("tool types", () => {
  it("should export type definitions", async () => {
    const module = await import("./tool.ts");
    assert(typeof module === "object");
  });
});
