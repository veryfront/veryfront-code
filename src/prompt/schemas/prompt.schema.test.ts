import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { prompt } from "../factory.ts";
import { getPromptConfigSchema } from "./prompt.schema.ts";

describe("prompt configuration schema", () => {
  it("matches the factory contract for explicit prompt ids", () => {
    const schema = getPromptConfigSchema();

    for (
      const { id, accepted } of [
        { id: "summary", accepted: true },
        { id: " summary ", accepted: true },
        { id: "", accepted: false },
        { id: " ", accepted: false },
        { id: "\t\n", accepted: false },
      ]
    ) {
      const config = { id, description: "desc", content: "Summarize" };
      const schemaAccepted = schema.safeParse(config).success;
      let factoryAccepted = true;
      try {
        prompt(config);
      } catch {
        factoryAccepted = false;
      }

      assertEquals(
        schemaAccepted,
        accepted,
        `schema acceptance for id=${JSON.stringify(id)}`,
      );
      assertEquals(
        factoryAccepted,
        accepted,
        `factory acceptance for id=${JSON.stringify(id)}`,
      );
    }
  });
});
