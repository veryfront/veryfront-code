import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("theme", () => {
  it("should load module", async () => {
    const module = await import("./theme.ts");
    assert(typeof module === "object");
  });
});
