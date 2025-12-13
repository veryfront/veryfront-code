import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("dev-handler", () => {
  it("should export handleDevCommand function", async () => {
    const module = await import("./dev-handler.ts");
    assertExists(module.handleDevCommand);
    assertEquals(typeof module.handleDevCommand, "function");
  });
});
