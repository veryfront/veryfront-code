import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("arg-parser", () => {
  it("should export parseCliArgs function", async () => {
    const module = await import("./arg-parser.ts");
    assertExists(module.parseCliArgs);
    assertEquals(typeof module.parseCliArgs, "function");
  });
});
