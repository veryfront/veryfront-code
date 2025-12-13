import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("json-schema types", () => {
  it("should export type definitions", async () => {
    const module = await import("./json-schema.ts");
    assert(typeof module === "object");
  });
});
