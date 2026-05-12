import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("OpenAI Provider", () => {
  it("loginOpenAI is a function", async () => {
    const { loginOpenAI } = await import("./openai.ts");
    assertEquals(typeof loginOpenAI, "function");
  });
});
