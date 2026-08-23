import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getPromptConfigSchema } from "./prompt.schema.ts";

describe("prompt configuration schema", () => {
  it("matches the factory contract for explicit prompt ids", () => {
    const schema = getPromptConfigSchema();

    assertEquals(
      schema.safeParse({ id: "summary", description: "desc", content: "Summarize" })
        .success,
      true,
    );
    for (const id of ["", " ", "\t\n"]) {
      assertEquals(
        schema.safeParse({ id, description: "desc", content: "Summarize" }).success,
        false,
        `id=${JSON.stringify(id)} is rejected`,
      );
    }
  });
});
