import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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

    it("should reject malformed YAML instead of applying weaker parsing rules", async () => {
      const error = await assertRejects(
        () =>
          parseSkillFrontmatter(`---
name: valid-name
description: Valid description
metadata: [
---
Instructions.`),
        Error,
        "Skill frontmatter contains invalid YAML",
      );
      assertEquals(error.message.includes("metadata"), false);
    });

    it("should reject oversized definitions before parsing YAML", async () => {
      await assertRejects(
        () => parseSkillFrontmatter("x".repeat(1_048_577)),
        Error,
        "must not exceed",
      );
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

    it("should reject a missing name instead of applying a directory fallback", () => {
      assertThrows(
        () => validateSkillMetadata({ description: "A skill" }, "dir-name"),
        Error,
        'required "name"',
      );
    });

    it("should require the skill name to match its directory", () => {
      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "frontmatter-name", description: "A skill" },
            "directory-name",
          ),
        Error,
        "must match its directory",
      );
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

    it("should reject consecutive hyphens in a name", () => {
      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "invalid--name", description: "desc" },
            "invalid--name",
          ),
        Error,
        "Invalid skill name",
      );
    });

    it("should parse allowed-tools from space-delimited string", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "Read Write Bash" },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write", "Bash"]);
    });

    it("should parse allowed_tools as an alias for allowed-tools", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", allowed_tools: "Read Write Bash" },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write", "Bash"]);
    });

    it("should parse allowed-tools from array", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": ["Read", "Write"] },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write"]);
    });

    it("should reject non-string entries in allowed-tools array", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": ["Read", 123] },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("expected all entries to be strings"), true);
      }
    });

    it("should reject accessor-backed allowed-tools entries without invoking them", () => {
      let invoked = false;
      const patterns = Object.defineProperty(["Read"], "0", {
        enumerable: true,
        get() {
          invoked = true;
          return "Write";
        },
      });

      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "test", description: "desc", "allowed-tools": patterns },
            "test",
          ),
        Error,
        "dense array",
      );
      assertEquals(invoked, false);
    });

    it("should handle empty allowed-tools", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "" },
        "test",
      );
      assertEquals(result.allowedTools, []);
    });

    it("should reject null allowed-tools instead of treating it as unrestricted", () => {
      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "test", description: "desc", "allowed-tools": null },
            "test",
          ),
        Error,
        "expected a string or array",
      );
    });

    it("should reject ambiguous allowed-tools aliases", () => {
      assertThrows(
        () =>
          validateSkillMetadata(
            {
              name: "test",
              description: "desc",
              "allowed-tools": "Read",
              allowed_tools: "Write",
            },
            "test",
          ),
        Error,
        "must not define both",
      );
    });

    it("should reject non-string non-array allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": 123 },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject object allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": { Read: true } },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject boolean allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": true },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject false boolean allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": false },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject zero numeric allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": 0 },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject invalid allowed-tools pattern", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": "Bash(git:*)" },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("invalid allowed-tools pattern"), true);
      }
    });

    it("should accept prefix wildcard patterns", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "api:* Read" },
        "test",
      );
      assertEquals(result.allowedTools, ["api:*", "Read"]);
    });

    it("should parse metadata as a string map", () => {
      const result = validateSkillMetadata(
        {
          name: "test",
          description: "desc",
          metadata: { author: "test", version: "2" },
        },
        "test",
      );
      assertEquals(result.metadata, { author: "test", version: "2" });
    });

    it("should reject metadata values that rely on implicit coercion", () => {
      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "test", description: "desc", metadata: { version: 2 } },
            "test",
          ),
        Error,
        "string values",
      );
    });

    it("should pass through license and compatibility", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", license: "MIT", compatibility: ">=1.0" },
        "test",
      );
      assertEquals(result.license, "MIT");
      assertEquals(result.compatibility, ">=1.0");
    });

    it("should reject descriptions over the specification limit", () => {
      const longDesc = "x".repeat(2000);
      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "test", description: longDesc },
            "test",
          ),
        Error,
        "must not exceed 1024",
      );
    });

    it("should enforce the compatibility field contract", () => {
      assertThrows(
        () =>
          validateSkillMetadata(
            { name: "test", description: "desc", compatibility: "x".repeat(501) },
            "test",
          ),
        Error,
        "1-500",
      );
    });

    it("should reject accessor-backed frontmatter fields", () => {
      const frontmatter = Object.defineProperty({}, "name", {
        enumerable: true,
        get() {
          throw new Error("must not execute");
        },
      });
      assertThrows(
        () => validateSkillMetadata(frontmatter, "test"),
        Error,
        "data properties only",
      );
    });
  });
});
