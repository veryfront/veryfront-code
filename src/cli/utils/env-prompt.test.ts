import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("env-prompt", () => {
  it("should export promptForEnvVars function", async () => {
    const module = await import("./env-prompt.ts");
    assertExists(module.promptForEnvVars);
    assertEquals(typeof module.promptForEnvVars, "function");
  });
});
