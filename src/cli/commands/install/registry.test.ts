import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  AI_TOOLS,
  getAllToolIds,
  getTemplateContent,
  getToolById,
  isValidToolId,
} from "./registry.ts";

describe("AI_TOOLS registry", () => {
  it("should have all required tools", () => {
    const ids = AI_TOOLS.map((t) => t.id);
    assertEquals(ids.includes("cursor"), true);
    assertEquals(ids.includes("claude-code"), true);
    assertEquals(ids.includes("skill"), true);
    assertEquals(ids.includes("copilot"), true);
    assertEquals(ids.includes("windsurf"), true);
    assertEquals(ids.includes("agents"), true);
  });

  it("should have valid fields for all tools", () => {
    for (const tool of AI_TOOLS) {
      assertEquals(typeof tool.id, "string");
      assertEquals(typeof tool.label, "string");
      assertEquals(typeof tool.file, "string");
      assertEquals(typeof tool.description, "string");
      assertEquals(typeof tool.template, "string");
      assertEquals(tool.id.length > 0, true);
      assertEquals(tool.label.length > 0, true);
      assertEquals(tool.file.length > 0, true);
    }
  });

  it("should have unique IDs", () => {
    const ids = AI_TOOLS.map((t) => t.id);
    const unique = new Set(ids);
    assertEquals(ids.length, unique.size);
  });
});

describe("getAllToolIds", () => {
  it("should return all tool IDs", () => {
    const ids = getAllToolIds();
    assertEquals(ids.length, AI_TOOLS.length);
    assertEquals(ids.includes("cursor"), true);
    assertEquals(ids.includes("claude-code"), true);
  });
});

describe("getToolById", () => {
  it("should return tool for valid ID", () => {
    const tool = getToolById("cursor");
    assertEquals(tool.id, "cursor");
    assertEquals(tool.label, "Cursor");
    assertEquals(tool.file, ".cursorrules");
  });

  it("should return tool for claude-code", () => {
    const tool = getToolById("claude-code");
    assertEquals(tool.id, "claude-code");
    assertEquals(tool.label, "Claude Code");
    assertEquals(tool.file, ".claude/CLAUDE.md");
  });

  it("should throw for invalid ID", () => {
    assertThrows(() => getToolById("invalid-tool"), Error);
  });

  it("should throw for empty ID", () => {
    assertThrows(() => getToolById(""), Error);
  });
});

describe("isValidToolId", () => {
  it("should return true for valid IDs", () => {
    assertEquals(isValidToolId("cursor"), true);
    assertEquals(isValidToolId("claude-code"), true);
    assertEquals(isValidToolId("skill"), true);
    assertEquals(isValidToolId("copilot"), true);
    assertEquals(isValidToolId("windsurf"), true);
    assertEquals(isValidToolId("agents"), true);
  });

  it("should return false for invalid IDs", () => {
    assertEquals(isValidToolId("invalid"), false);
    assertEquals(isValidToolId(""), false);
    assertEquals(isValidToolId("CURSOR"), false);
    assertEquals(isValidToolId("Cursor"), false);
  });
});

describe("getTemplateContent", () => {
  it("should load cursor template", async () => {
    const content = await getTemplateContent("cursor");
    assertEquals(content.includes("Veryfront"), true);
    assertEquals(content.includes("veryfront dev"), true);
  });

  it("should load claude-code template", async () => {
    const content = await getTemplateContent("claude-code");
    assertEquals(content.includes("Veryfront"), true);
    assertEquals(content.includes("veryfront dev"), true);
  });

  it("should load skill template with YAML frontmatter", async () => {
    const content = await getTemplateContent("skill");
    assertEquals(content.startsWith("---"), true);
    assertEquals(content.includes("name: veryfront"), true);
  });

  it("should load agents template", async () => {
    const content = await getTemplateContent("agents");
    assertEquals(content.includes("Veryfront"), true);
  });

  it("should throw for invalid tool ID", async () => {
    let error: Error | null = null;
    try {
      await getTemplateContent("invalid");
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error !== null, true);
  });
});
