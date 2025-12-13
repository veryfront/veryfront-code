import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("build-handler", () => {
  it("should export handleBuildCommand function", async () => {
    const module = await import("./build-handler.ts");
    assertExists(module.handleBuildCommand);
    assertEquals(typeof module.handleBuildCommand, "function");
  });
});
