import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Anthropic Provider", () => {
  it("loginAnthropic is a function", async () => {
    const { loginAnthropic } = await import("./anthropic.ts");
    assertEquals(typeof loginAnthropic, "function");
  });
});
