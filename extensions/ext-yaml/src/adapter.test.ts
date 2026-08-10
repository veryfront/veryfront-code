import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  createStdYamlSkillDocumentParserProvider,
  createYamlParser,
  parseYamlSource,
} from "./adapter.ts";

describe("yaml Skill document parser", () => {
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

describe("yaml general parser", () => {
  it("decodes without the Skill boundary's JSON restriction", () => {
    const parser = createYamlParser();

    assertEquals(parser.parseYaml("tags:\n  - one\n  - two\nnested:\n  key: value"), {
      tags: ["one", "two"],
      nested: { key: "value" },
    });
    assertEquals(parser.parseYaml(""), null);
  });

  it("rejects duplicate keys unless the caller opts in", () => {
    assertThrows(() => parseYamlSource("name: a\nname: b"), SyntaxError);
    assertEquals(parseYamlSource("name: a\nname: b", { allowDuplicateKeys: true }), {
      name: "b",
    });
  });

  it("rejects a multi-document stream", () => {
    assertThrows(
      () => parseYamlSource("a: 1\n---\nb: 2"),
      SyntaxError,
      "more than 1 document",
    );
  });

  it("rejects a tag it cannot resolve instead of guessing a value", () => {
    assertThrows(() => parseYamlSource("x: !custom value"), SyntaxError);
  });

  it("still decodes when Object.prototype carries a read-only value property", () => {
    // The framework's Skill and agent trust boundaries assert this across
    // roughly twenty test files: a poisoned Object.prototype must not stop a
    // well-formed document from decoding, or the hardening under test is never
    // reached. `yaml` assigns `this.value` while building its AST.
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "poisoned",
    });
    try {
      assertEquals(parseYamlSource("name: research", { schema: "json" }), {
        name: "research",
      });
    } finally {
      delete (Object.prototype as Record<string, unknown>).value;
    }

    // The poison is restored for whoever installed it.
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "poisoned",
    });
    try {
      parseYamlSource("name: research");
      assertEquals(
        (Object.getOwnPropertyDescriptor(Object.prototype, "value") ?? {}).value,
        "poisoned",
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).value;
    }
  });

  it("resolves the YAML 1.2 core schema, not YAML 1.1", () => {
    // These three are the deliberate, documented differences from
    // jsr:@std/yaml. Underscore digit separators, timestamps, and `<<` merge
    // keys are YAML 1.1 types that the 1.2 core schema does not resolve.
    assertEquals(parseYamlSource("a: 1_000"), { a: "1_000" });
    assertEquals(parseYamlSource("created: 2024-01-02"), { created: "2024-01-02" });
    assertEquals(parseYamlSource("base: &b\n  x: 1\nchild:\n  <<: *b\n  y: 2"), {
      base: { x: 1 },
      child: { "<<": { x: 1 }, y: 2 },
    });
  });
});

describe("@std/yaml JSON schema fidelity", () => {
  it("does not widen YAML 1.1 octals under the JSON schema", () => {
    // The parser ran the core schema before the schema was forwarded, so this
    // decoded to the number 7 -- a type the caller asked the JSON schema to
    // exclude.
    const parsed = parseYamlSource("o: 0o7", { schema: "json" }) as { o: unknown };

    assertEquals(parsed.o, "0o7");
  });

  it("accepts ordinary metadata, which the JSON schema flags per scalar", () => {
    // Every plain scalar raises TAG_RESOLVE_FAILED under this schema, so a
    // parser that rejected on any diagnostic would reject every Skill document.
    assertEquals(
      parseYamlSource("name: code-review\ndescription: Review code.", { schema: "json" }),
      { name: "code-review", description: "Review code." },
    );
  });

  it("still reports the real error hiding behind those diagnostics", () => {
    // A duplicate key raises DUPLICATE_KEY *after* two TAG_RESOLVE_FAILEDs, so
    // reading the first diagnostic would have surfaced the benign one.
    // Asserting the type alone would pass on the TAG_RESOLVE_FAILED that
    // precedes it, which is the very confusion this guards against.
    assertThrows(
      () => parseYamlSource("a: 1\na: 2", { schema: "json" }),
      SyntaxError,
      "Map keys must be unique",
    );
  });
});
