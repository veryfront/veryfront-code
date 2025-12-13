import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("command-router", () => {
  it("should export routeCommand function", async () => {
    const module = await import("./command-router.ts");
    assertExists(module.routeCommand);
    assertEquals(typeof module.routeCommand, "function");
  });
});
