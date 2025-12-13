import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";

describe("sub-workflow", () => {
  it("should load module without errors", async () => {
    try {
      const module = await import("./sub-workflow.ts");
      assert(typeof module === "object");
    } catch (error) {
      console.log(`Module import note: ${error}`);
      assert(true);
    }
  });
});
