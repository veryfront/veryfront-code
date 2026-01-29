import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    const expected = ["cursor", "claude-code", "skill", "copilot", "windsurf", "agents"] as const;
    for (const id of expected) {
      assertEquals(ids.includes(id), true);
    }
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
    assertEquals(ids.length, new Set(ids).size);
  });
});

describe("getAllToolIds", () => {
  it("should return all tool IDs", () => {
    const ids = getAllToolIds();
    assertEquals(ids.length, AI_TOOLS.length);
    const expected = ["cursor", "claude-code"] as const;
    for (const id of expected) {
      assertEquals(ids.includes(id), true);
    }
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
    const valid = ["cursor", "claude-code", "skill", "copilot", "windsurf", "agents"] as const;
    for (const id of valid) {
      assertEquals(isValidToolId(id), true);
    }
  });

  it("should return false for invalid IDs", () => {
    for (const id of ["invalid", "", "CURSOR", "Cursor"]) {
      assertEquals(isValidToolId(id), false);
    }
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
    await assertThrows(() => getTemplateContent("invalid"), Error);
  });
});
