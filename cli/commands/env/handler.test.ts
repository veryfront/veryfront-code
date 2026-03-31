import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Env Command", () => {
  it("handler is a function", async () => {
    const { handleEnvCommand } = await import("./handler.ts");
    assertEquals(typeof handleEnvCommand, "function");
  });
});
