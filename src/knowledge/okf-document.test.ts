import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import { YamlParserProviderName } from "#veryfront/extensions/parser/yaml-parser.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  inspectOkfDocument,
  isRuntimeCapabilityError,
  OKF_SPEC_REVISION,
  OKF_SPEC_VERSION,
} from "./okf-document.ts";

describe("OKF document inspection", () => {
  it("preserves canonical source, nested extensions, timestamps and authored links", () => {
    const source = [
      "---",
      "type: Custom Concept",
      "title: Invoice policy",
      "generated:",
      "  at: 2026-10-07T12:00:00+02:00",
      "  by: process:fixture",
      "verified:",
      "  by: human:reviewer",
      "sources:",
      "  - id: policy",
      "    resource: /references/policy.md",
      "extension:",
      "  nested: [one, two]",
      "---",
      "",
      "# Policy",
      "[Relative](../related.md#details) [Root](/references/policy.md)",
      "[External](https://example.invalid/policy) [Missing](missing.md)",
      "",
    ].join("\r\n");
    const inspected = inspectOkfDocument("policies/invoice.md", source);
    assertEquals(inspected.envelopeConforms, true);
    assertEquals(inspected.path, "policies/invoice.md");
    assertEquals(inspected.source, source);
    assertEquals(inspected.body, source.slice(source.indexOf("# Policy") - 2));
    assertEquals(inspected.metadata.extension, { nested: ["one", "two"] });
    assertEquals(inspected.metadata.generated, {
      at: "2026-10-07T12:00:00+02:00",
      by: "process:fixture",
    });
    assertEquals(inspected.metadata.verified, { by: "human:reviewer" });
    assertEquals(inspected.metadata.sources, [{ id: "policy", resource: "/references/policy.md" }]);
    assertEquals(OKF_SPEC_VERSION, "0.2");
    assertEquals(OKF_SPEC_REVISION.length, 40);
  });

  it("keeps legacy metadata and body while reporting the missing required type", () => {
    const source = "---\nsource: old.txt\nsource_type: txt\nadded: 2026-10-07\n---\nLegacy body\n";
    const inspected = inspectOkfDocument("legacy.md", source);
    assertEquals(inspected.source, source);
    assertEquals(inspected.body, "Legacy body\n");
    assertEquals(inspected.metadata, {
      source: "old.txt",
      source_type: "txt",
      added: "2026-10-07",
    });
    assertEquals(inspected.envelopeConforms, false);
    assertEquals(inspected.diagnostics.map((value) => value.code), ["missing_type"]);
  });

  it("reports malformed mappings and incomplete envelopes without rewriting source", () => {
    for (
      const source of [
        "---\ntype: [unfinished\n---\nBody",
        "---\ntype: Topic\nx: [Requires env access\n---\nBody",
        "---\ntype: Playbook\nBody",
        "---\n- item\n---\nBody",
        "---\ntype: Topic---\nBody",
        "---\r\ntype: Topic---\r\nBody",
      ]
    ) {
      const inspected = inspectOkfDocument("invalid.md", source);
      assertEquals(inspected.source, source);
      assertEquals(inspected.envelopeConforms, false);
      assertEquals(inspected.diagnostics.map((value) => value.code), ["invalid_frontmatter"]);
    }
  });

  it("distinguishes parser capability failures from malformed OKF", () => {
    const deniedEnv = new Error('Requires env access to "LOG_TOKENS"');
    deniedEnv.name = "NotCapable";
    assertEquals(
      isRuntimeCapabilityError(
        new SyntaxError("YAML parser failed", {
          cause: deniedEnv,
        }),
      ),
      true,
    );
    assertEquals(
      isRuntimeCapabilityError(new SyntaxError("x: [Requires env access\n                   ^")),
      false,
    );
    assertEquals(isRuntimeCapabilityError(new Error("Unexpected scalar at line 1")), false);
  });

  it("preserves inline dashes in valid YAML values before a proper delimiter", () => {
    const source = "---\ntype: Topic\nseparator: abc---\n---\nBody";
    const inspected = inspectOkfDocument("topic.md", source);
    assertEquals(inspected.envelopeConforms, true);
    assertEquals(inspected.metadata.separator, "abc---");
    assertEquals(inspected.body, "Body");
  });

  it("keeps reserved files outside the concept type requirement at every level", () => {
    for (const path of ["index.md", "nested/index.md", "log.md", "nested/log.md"]) {
      const inspected = inspectOkfDocument(path, "# Bundle navigation\n[Concept](topic.md)\n");
      assertEquals(inspected.kind, path.endsWith("index.md") ? "index" : "log");
      assertEquals(inspected.envelopeConforms, true);
    }
  });

  it("requires a non-empty string type without rejecting unfamiliar type names", () => {
    for (const type of ["true", "42", "''"]) {
      assertEquals(
        inspectOkfDocument("topic.md", `---\ntype: ${type}\n---\n`).diagnostics[0]?.code,
        "invalid_type",
      );
    }
    assertEquals(
      inspectOkfDocument("topic.md", "---\ntype: Unfamiliar Type\nextra: retained\n---\n")
        .envelopeConforms,
      true,
    );
  });

  it("distinguishes an empty YAML mapping from malformed or repeated keys", () => {
    assertEquals(
      inspectOkfDocument("topic.md", "---\n---\nBody").diagnostics[0]?.code,
      "missing_type",
    );
    assertEquals(inspectOkfDocument("index.md", "---\n---\nNavigation").envelopeConforms, true);
    const duplicate = "---\ntype: First\ntype: Second\n---\nBody";
    assertEquals(
      inspectOkfDocument("topic.md", duplicate).diagnostics[0]?.code,
      "invalid_frontmatter",
    );
    assertEquals(inspectOkfDocument("topic.md", duplicate).source, duplicate);
  });
});

for (const [label, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  it(`preserves Markdown after an empty ${label} envelope before a later horizontal rule`, () => {
    const body = ["# Navigation", "", "---", "Footer", ""].join(newline);
    const source = ["---", "---", ""].join(newline) + body;
    for (const path of ["index.md", "nested/log.md", "topic.md"]) {
      const inspected = inspectOkfDocument(path, source);
      assertEquals(inspected.body, body);
      assertEquals(inspected.metadata, {});
      assertEquals(inspected.source, source);
      assertEquals(
        inspected.diagnostics.map((diagnostic) => diagnostic.code),
        path === "topic.md" ? ["missing_type"] : [],
      );
    }
  });
}

it("keeps Unicode line separators inside YAML values instead of closing the envelope", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    const title = `abc${separator}---`;
    const source = `---\ntype: Topic\ntitle: ${title}\n---\nBody`;
    const inspected = inspectOkfDocument("topic.md", source);
    assertEquals(inspected.metadata.title, title);
    assertEquals(inspected.body, "Body");
    assertEquals(inspected.envelopeConforms, true);
  }
});

it("does not accept a closing delimiter followed by a standalone carriage return", () => {
  const source = "---\ntype: Topic\n---\rBody";
  const inspected = inspectOkfDocument("topic.md", source);
  assertEquals(inspected.body, source);
  assertEquals(inspected.diagnostics.map((diagnostic) => diagnostic.code), ["invalid_frontmatter"]);
});

it("rejects nested index frontmatter without losing source or body", () => {
  const source = "---\nokf_version: 0.2\n---\nNavigation\n";
  const nested = inspectOkfDocument("nested/index.md", source);
  assertEquals(nested.envelopeConforms, false);
  assertEquals(nested.diagnostics.map((value) => value.code), ["invalid_frontmatter"]);
  assertEquals(nested.source, source);
  assertEquals(nested.body, "Navigation\n");
  assertEquals(inspectOkfDocument("index.md", source).envelopeConforms, true);
});

it("propagates YAML parser infrastructure failures", () => {
  const previous = tryResolve(YamlParserProviderName);
  const unavailable = MISSING_EXTENSION_ERROR.create({
    message: "Missing YAML parser",
    detail: "Install @veryfront/ext-yaml",
  });
  try {
    for (const error of [unavailable, new TypeError("YAML provider must be synchronous")]) {
      register(YamlParserProviderName, {
        parseYaml: () => {
          throw error;
        },
      });
      const thrown = assertThrows(() =>
        inspectOkfDocument("topic.md", "---\ntype: Topic\n---\nBody")
      );
      assertEquals(thrown, error);
    }
  } finally {
    if (previous === undefined) unregister(YamlParserProviderName);
    else register(YamlParserProviderName, previous);
  }
});

it("classifies Windows reserved paths before validating their envelopes", () => {
  for (const path of ["nested\\index.md", "nested\\log.md"]) {
    const value = inspectOkfDocument(path, "Navigation");
    assertEquals(value.kind, path.endsWith("index.md") ? "index" : "log");
    assertEquals(value.envelopeConforms, true);
  }
  assertEquals(
    inspectOkfDocument("nested\\index.md", "---\nokf_version: 0.2\n---\nBody").envelopeConforms,
    false,
  );
});
