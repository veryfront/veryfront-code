import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("terminal-select", () => {
  it("should export select function", async () => {
    const module = await import("./terminal-select.ts");
    assertExists(module.select);
    assertEquals(typeof module.select, "function");
  });

  it("should export multiSelect function", async () => {
    const module = await import("./terminal-select.ts");
    assertExists(module.multiSelect);
    assertEquals(typeof module.multiSelect, "function");
  });
});
