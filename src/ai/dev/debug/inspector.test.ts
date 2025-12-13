import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("inspector", () => {
  it("should load module", async () => {
    const module = await import("./inspector.ts");
    assert(typeof module === "object");
  });
});
