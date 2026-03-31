import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Rollback Command", () => {
  it("handler is a function", async () => {
    const { handleRollbackCommand } = await import("./handler.ts");
    assertEquals(typeof handleRollbackCommand, "function");
  });
});
