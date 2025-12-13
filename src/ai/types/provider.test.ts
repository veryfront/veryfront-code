import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("provider types", () => {
  it("should export type definitions", async () => {
    const module = await import("./provider.ts");
    assert(typeof module === "object");
  });
});
