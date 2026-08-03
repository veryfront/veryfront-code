import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "@std/assert";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
import {
  buildRuntimeSkillDefinition,
  parseRuntimeSkillDocument,
  parseRuntimeSkillMetadata,
} from "./skill-metadata.ts";

Deno.test("public runtime Skill parsers use the extension-owned default without prior activation", () => {
  const previousProvider = tryResolve<SkillDocumentParserProvider>(
    SkillDocumentParserProviderName,
  );
  unregister(SkillDocumentParserProviderName);

  try {
    const content = `---
name: direct-public
description: Direct public parser
allowed-tools:
  - Read
metadata:
  owner: framework
---
Public body`;

    const document = parseRuntimeSkillDocument(content);
    assertExists(document);
    assertEquals(document.body, "Public body");
    assertEquals(document.metadata.name, "direct-public");
    assertEquals(document.metadata.allowedTools, ["Read"]);
    assertEquals(document.metadata.metadata, { owner: "framework" });

    const metadata = parseRuntimeSkillMetadata(content);
    assertExists(metadata);
    assertEquals(metadata.description, "Direct public parser");

    const definition = buildRuntimeSkillDefinition({
      id: "direct-public",
      content,
    });
    assertExists(definition);
    assertEquals(definition.name, "direct-public");
    assertEquals(definition.instructions, content);
    assertEquals(definition.allowedTools, ["Read"]);

    assertEquals(
      tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName),
      undefined,
    );
  } finally {
    unregister(SkillDocumentParserProviderName);
    if (previousProvider !== undefined) {
      register(SkillDocumentParserProviderName, previousProvider);
    }
  }
});
