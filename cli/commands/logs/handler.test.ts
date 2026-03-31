import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Logs Command", () => {
  it("handler is a function", async () => {
    const { handleLogsCommand } = await import("./handler.ts");
    assertEquals(typeof handleLogsCommand, "function");
  });
});
