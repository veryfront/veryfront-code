import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("generate-handler", () => {
  it("should export handleGenerateCommand function", async () => {
    const module = await import("./generate-handler.ts");
    assertExists(module.handleGenerateCommand);
    assertEquals(typeof module.handleGenerateCommand, "function");
  });
});
