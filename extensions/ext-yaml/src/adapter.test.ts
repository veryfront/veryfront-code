import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createStdYamlSkillDocumentParserProvider } from "./adapter.ts";

describe("@std/yaml Skill document parser", () => {
  it("decodes the YAML source without owning the Skill document envelope", () => {
    const parser = createStdYamlSkillDocumentParserProvider();

    assertEquals(
      parser.parseFrontmatter([
        "name: demo",
        'description: "A: quoted description"',
        "allowed-tools:",
        "  - Read",
        "  - Execute",
        "instructions: |",
        "  First line",
        "  Second line",
      ].join("\n")),
      {
        name: "demo",
        description: "A: quoted description",
        "allowed-tools": ["Read", "Execute"],
        instructions: "First line\nSecond line\n",
      },
    );
  });

  it("uses the JSON-safe YAML schema at the extension boundary", () => {
    const parser = createStdYamlSkillDocumentParserProvider();
    const parsed = parser.parseFrontmatter("created: 2024-01-02") as {
      created: unknown;
    };

    assertEquals(parsed.created, "2024-01-02");
    assertThrows(
      () => parser.parseFrontmatter("payload: !!binary SGVsbG8="),
      SyntaxError,
    );
  });

  it("rejects malformed, duplicate-key, and multi-document YAML", () => {
    const parser = createStdYamlSkillDocumentParserProvider();

    for (
      const source of [
        "name: [",
        "name: first\nname: second",
        "name: first\n---\nname: second",
      ]
    ) {
      assertThrows(() => parser.parseFrontmatter(source), SyntaxError);
    }
  });

  it("leaves mapping-root policy to core", () => {
    const parser = createStdYamlSkillDocumentParserProvider();

    assertEquals(parser.parseFrontmatter("plain scalar"), "plain scalar");
    assertEquals(parser.parseFrontmatter("- first\n- second"), [
      "first",
      "second",
    ]);
  });
});
