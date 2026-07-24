import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deriveKnowledgeSourceDocumentChunk } from "../../chat/knowledge-source-document.ts";

const KNOWLEDGE_PATH =
  "knowledge/knowledge-ingest-20260723131451088-6d16440c-veryfront-equity-story-13july26.md";

describe("agent/streaming/knowledge-source-document", () => {
  it("preserves a canonical get_file knowledge path character-for-character", () => {
    assertEquals(
      deriveKnowledgeSourceDocumentChunk({
        toolName: "get_file",
        output: { path: KNOWLEDGE_PATH, content: "# Equity story" },
      }),
      {
        type: "source-document",
        sourceId: KNOWLEDGE_PATH,
        mediaType: "text/markdown",
        title: KNOWLEDGE_PATH,
        filename: KNOWLEDGE_PATH,
      },
    );
  });

  it("supports wrapped MCP structured output", () => {
    assertEquals(
      deriveKnowledgeSourceDocumentChunk({
        toolName: "get_file",
        output: { structuredContent: { path: KNOWLEDGE_PATH, content: "# Equity story" } },
      })?.sourceId,
      KNOWLEDGE_PATH,
    );
  });

  it("does not cite search results, source files, or malformed outputs", () => {
    assertEquals(
      deriveKnowledgeSourceDocumentChunk({
        toolName: "search_knowledge",
        output: { path: KNOWLEDGE_PATH },
      }),
      null,
    );
    assertEquals(
      deriveKnowledgeSourceDocumentChunk({
        toolName: "get_file",
        output: { path: "agents/support.ts" },
      }),
      null,
    );
    assertEquals(
      deriveKnowledgeSourceDocumentChunk({ toolName: "get_file", output: {} }),
      null,
    );
    assertEquals(
      deriveKnowledgeSourceDocumentChunk({
        toolName: "get_file",
        output: { path: KNOWLEDGE_PATH },
      }),
      null,
    );
  });
});
