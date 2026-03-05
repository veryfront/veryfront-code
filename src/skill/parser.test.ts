import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSkillFrontmatter, validateSkillMetadata } from "./parser.ts";

describe("src/skill/parser", () => {
  describe("parseSkillFrontmatter", () => {
    it("should parse valid frontmatter with all fields", async () => {
      const content = `---
name: my-skill
description: A test skill
allowed-tools: Read Write
license: MIT
---
# Instructions
Do the thing.`;

      const result = await parseSkillFrontmatter(content);
      assertEquals(result.frontmatter.name, "my-skill");
      assertEquals(result.frontmatter.description, "A test skill");
      assertEquals(result.frontmatter["allowed-tools"], "Read Write");
      assertEquals(result.frontmatter.license, "MIT");
      assertEquals(result.body.trim(), "# Instructions\nDo the thing.");
    });

    it("should parse minimal frontmatter", async () => {
      const content = `---
name: minimal
description: Just a description
---
Body text.`;

      const result = await parseSkillFrontmatter(content);
      assertEquals(result.frontmatter.name, "minimal");
      assertEquals(result.frontmatter.description, "Just a description");
      assertEquals(result.body.trim(), "Body text.");
    });

    it("should handle no frontmatter", async () => {
      const content = "Just a plain markdown file.";
      const result = await parseSkillFrontmatter(content);
      assertEquals(Object.keys(result.frontmatter).length, 0);
      assertEquals(result.body, "Just a plain markdown file.");
    });

    it("should handle empty content", async () => {
      const result = await parseSkillFrontmatter("");
      assertEquals(result.body, "");
    });
  });

  describe("validateSkillMetadata", () => {
    it("should validate valid frontmatter", () => {
      const result = validateSkillMetadata(
        { name: "my-skill", description: "A skill" },
        "my-skill",
      );
      assertEquals(result.name, "my-skill");
      assertEquals(result.description, "A skill");
    });

    it("should fall back to directory name when name is missing", () => {
      const result = validateSkillMetadata(
        { description: "A skill" },
        "dir-name",
      );
      assertEquals(result.name, "dir-name");
    });

    it("should throw on missing description", () => {
      try {
        validateSkillMetadata({ name: "test" }, "test");
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("missing"), true);
      }
    });

    it("should throw on invalid name (uppercase)", () => {
      try {
        validateSkillMetadata(
          { name: "MySkill", description: "desc" },
          "MySkill",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid skill name"), true);
      }
    });

    it("should throw on name too long", () => {
      const longName = "a".repeat(65);
      try {
        validateSkillMetadata(
          { name: longName, description: "desc" },
          longName,
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid skill name"), true);
      }
    });

    it("should parse allowed-tools from space-delimited string", () => {
      const result = validateSkillMetadata(
        { description: "desc", "allowed-tools": "Read Write Bash" },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write", "Bash"]);
    });

    it("should parse allowed-tools from array", () => {
      const result = validateSkillMetadata(
        { description: "desc", "allowed-tools": ["Read", "Write"] },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write"]);
    });

    it("should reject non-string entries in allowed-tools array", () => {
      try {
        validateSkillMetadata(
          { description: "desc", "allowed-tools": ["Read", 123] },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("expected all entries to be strings"), true);
      }
    });

    it("should handle empty allowed-tools", () => {
      const result = validateSkillMetadata(
        { description: "desc", "allowed-tools": "" },
        "test",
      );
      assertEquals(result.allowedTools, undefined);
    });

    it("should reject invalid allowed-tools pattern", () => {
      try {
        validateSkillMetadata(
          { description: "desc", "allowed-tools": "Bash(git:*)" },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("invalid allowed-tools pattern"), true);
      }
    });

    it("should accept prefix wildcard patterns", () => {
      const result = validateSkillMetadata(
        { description: "desc", "allowed-tools": "api:* Read" },
        "test",
      );
      assertEquals(result.allowedTools, ["api:*", "Read"]);
    });

    it("should parse metadata as string map", () => {
      const result = validateSkillMetadata(
        { description: "desc", metadata: { author: "test", version: 2 } },
        "test",
      );
      assertEquals(result.metadata, { author: "test", version: "2" });
    });

    it("should pass through license and compatibility", () => {
      const result = validateSkillMetadata(
        { description: "desc", license: "MIT", compatibility: ">=1.0" },
        "test",
      );
      assertEquals(result.license, "MIT");
      assertEquals(result.compatibility, ">=1.0");
    });

    it("should trim description to max length", () => {
      const longDesc = "x".repeat(2000);
      const result = validateSkillMetadata(
        { description: longDesc },
        "test",
      );
      assertEquals(result.description.length, 1024);
    });
  });
});
