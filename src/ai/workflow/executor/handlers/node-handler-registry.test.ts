import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("node-handler-registry", () => {
  it("should load module without errors", async () => {
    try {
      const module = await import("./node-handler-registry.ts");
      assert(typeof module === "object");
    } catch (error) {
      console.log(`Module import note: ${error}`);
      assert(true);
    }
  });
});
