import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("mcp types", () => {
  it("should export type definitions", async () => {
    const module = await import("./mcp.ts");
    assert(typeof module === "object");
  });
});
