import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("client", () => {
  it("should load module", async () => {
    const module = await import("./client.ts");
    assert(typeof module === "object");
  });
});
