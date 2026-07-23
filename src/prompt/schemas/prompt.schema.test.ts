import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getPromptConfigSchema } from "./prompt.schema.ts";

describe("prompt configuration schema", () => {
  it("accepts exactly one static or dynamic content source", () => {
    const schema = getPromptConfigSchema();

    assertEquals(
      schema.safeParse({ description: "Static", content: "Hello {name}" }).success,
      true,
    );
    assertEquals(
      schema.safeParse({
        description: "Dynamic",
        generate: () => "Hello",
        arguments: [{
          name: "topic",
          description: "Topic to summarize",
          required: true,
        }],
      }).success,
      true,
    );
  });

  it("rejects ambiguous, unbounded, unsafe, and unknown configuration", () => {
    const schema = getPromptConfigSchema();
    const invalid = [
      { description: "Missing content" },
      { description: "Both", content: "Static", generate: () => "Dynamic" },
      { description: "Blank", content: " " },
      { description: "Unsafe", content: "Hello\0" },
      { description: "Unicode bytes", content: "€".repeat(400_000) },
      { description: "Unknown", content: "Hello", typo: true },
      {
        description: "Duplicate arguments",
        content: "Hello {name}",
        arguments: [{ name: "name" }, { name: "name" }],
      },
      {
        description: "Unsafe argument",
        generate: () => "Hello",
        arguments: [{ name: "line\nbreak" }],
      },
      {
        description: "Unknown argument property",
        generate: () => "Hello",
        arguments: [{ name: "topic", fallback: "all" }],
      },
      {
        description: "Mismatched static arguments",
        content: "Hello {name}",
        arguments: [{ name: "other" }],
      },
      {
        description: "Excessive placeholders",
        content: "{value}".repeat(1_025),
      },
    ];

    for (const config of invalid) {
      assertEquals(schema.safeParse(config).success, false);
    }
  });
});
