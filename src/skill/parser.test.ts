import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseSkillFileFrontmatter,
  parseSkillFrontmatter,
  validateSkillFileMetadata,
  validateSkillMetadata,
} from "./parser.ts";
import * as skillParser from "./parser.ts";
import { SKILL_NAME_REGEX } from "./types.ts";

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

    it("fails closed on malformed YAML through the public parser", async () => {
      await assertRejects(
        () =>
          parseSkillFrontmatter(`---
name: malformed
description: [unterminated
---
Body`),
        Error,
      );

      const unsafeParser = (
        skillParser as typeof skillParser & {
          parseUnsafeLegacySkillFrontmatter?: typeof parseSkillFrontmatter;
        }
      ).parseUnsafeLegacySkillFrontmatter;
      assertEquals(typeof unsafeParser, "function");
      const result = await unsafeParser!(`---
name: malformed
description: [unterminated
---
Body`);
      assertEquals(result.frontmatter, {
        name: "malformed",
        description: "[unterminated",
      });
      assertEquals(result.body, "Body");
    });

    it("bounds public documents while retaining an explicitly unsafe compatibility parser", async () => {
      const content = "x".repeat(1_048_577);
      await assertRejects(
        () => parseSkillFrontmatter(content),
        RangeError,
        "exceeds",
      );
      const unsafeParser = (
        skillParser as typeof skillParser & {
          parseUnsafeLegacySkillFrontmatter?: typeof parseSkillFrontmatter;
        }
      ).parseUnsafeLegacySkillFrontmatter;
      assertEquals(typeof unsafeParser, "function");
      assertEquals((await unsafeParser!(content)).body, content);
    });

    it("strict file parsing rejects malformed and oversized documents", async () => {
      await assertRejects(
        () =>
          parseSkillFileFrontmatter(`---
name: malformed
description: [unterminated
---
Body`),
        Error,
      );
      await assertRejects(
        () => parseSkillFileFrontmatter("x".repeat(1_048_577)),
        RangeError,
        "exceeds",
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
      assertEquals(result.displayName, undefined);
      assertEquals(result.description, "A skill");
    });

    it("returns detached metadata through the historical mutable public contract", () => {
      const allowedTools = ["Read"];
      const metadata = { author: "Veryfront" };
      const result = validateSkillMetadata(
        {
          name: "my-skill",
          description: "A skill",
          "allowed-tools": allowedTools,
          metadata,
        },
        "my-skill",
      );

      result.allowedTools?.push("Write");
      if (result.metadata) result.metadata.author = "Changed";
      assertEquals(result.allowedTools, ["Read", "Write"]);
      assertEquals(result.metadata, { author: "Changed" });
      assertEquals(allowedTools, ["Read"]);
      assertEquals(metadata, { author: "Veryfront" });
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

    it("should preserve a legacy display-style frontmatter name as displayName", () => {
      const result = validateSkillMetadata(
        { name: "Process Email", description: "desc" },
        "process-email",
      );
      assertEquals(result.name, "process-email");
      assertEquals(result.displayName, "Process Email");
    });

    it("should preserve a mismatched frontmatter name as displayName", () => {
      const result = validateSkillMetadata(
        { name: "email", description: "desc" },
        "process-email",
      );
      assertEquals(result.name, "process-email");
      assertEquals(result.displayName, "email");
    });

    it("should prefer metadata.display_name over a legacy frontmatter display name", () => {
      const result = validateSkillMetadata(
        {
          name: "Process Email",
          description: "desc",
          metadata: { display_name: "Email Processor", owner: "ops" },
        },
        "process-email",
      );
      assertEquals(result.name, "process-email");
      assertEquals(result.displayName, "Email Processor");
      assertEquals(result.metadata, { display_name: "Email Processor", owner: "ops" });
    });

    it("should throw on invalid directory/canonical name", () => {
      try {
        validateSkillMetadata(
          { name: "process-email", description: "desc" },
          "Process Email",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid skill name"), true);
      }
    });

    it("should reject whitespace around the directory canonical name", () => {
      try {
        validateSkillMetadata(
          { description: "desc" },
          " process-email ",
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

    it("preserves the historical public name matcher", () => {
      assertEquals(SKILL_NAME_REGEX.source, "^[a-z0-9][a-z0-9-]{0,63}$");
      for (const name of ["trailing-", "double--hyphen"]) {
        assertEquals(
          validateSkillMetadata({ name, description: "desc" }, name).name,
          name,
        );
      }
    });

    it("should parse allowed-tools from space-delimited string", () => {
      const result = validateSkillMetadata(
        { description: "desc", "allowed-tools": "Read Write Bash" },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write", "Bash"]);
    });

    it("should parse allowed_tools as an alias for allowed-tools", () => {
      const result = validateSkillMetadata(
        { description: "desc", allowed_tools: "Read Write Bash" },
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

    it("preserves legacy empty allowed-tools omission", () => {
      const result = validateSkillMetadata(
        { description: "desc", "allowed-tools": "" },
        "test",
      );
      assertEquals(result.allowedTools, undefined);
    });

    it("preserves legacy null and canonical alias precedence", () => {
      assertEquals(
        validateSkillMetadata(
          { description: "desc", "allowed-tools": null },
          "test",
        ).allowedTools,
        undefined,
      );
      assertEquals(
        validateSkillMetadata(
          {
            description: "desc",
            "allowed-tools": "Read",
            allowed_tools: "Write",
          },
          "test",
        ).allowedTools,
        ["Read"],
      );
    });

    it("should reject non-string non-array allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { description: "desc", "allowed-tools": 123 },
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
          { description: "desc", "allowed-tools": { Read: true } },
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
          { description: "desc", "allowed-tools": true },
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
          { description: "desc", "allowed-tools": false },
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
          { description: "desc", "allowed-tools": 0 },
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
        { description: "desc", metadata: { author: "test", version: "2" } },
        "test",
      );
      assertEquals(result.metadata, { author: "test", version: "2" });
    });

    it("coerces metadata values through the historical public contract", () => {
      assertEquals(
        validateSkillMetadata(
          { description: "desc", metadata: { version: 2, stable: true } },
          "test",
        ).metadata,
        { version: "2", stable: "true" },
      );
    });

    it("should pass through license and compatibility", () => {
      const result = validateSkillMetadata(
        { description: "desc", license: "MIT", compatibility: ">=1.0" },
        "test",
      );
      assertEquals(result.license, "MIT");
      assertEquals(result.compatibility, ">=1.0");
    });

    it("truncates descriptions through the historical public contract", () => {
      const longDesc = "x".repeat(2000);
      assertEquals(
        validateSkillMetadata(
          { description: longDesc },
          "test",
        ).description,
        "x".repeat(1024),
      );
    });

    it("preserves unbounded compatibility through the historical public contract", () => {
      assertEquals(
        validateSkillMetadata(
          { description: "desc", compatibility: "x".repeat(501) },
          "test",
        ).compatibility,
        "x".repeat(501),
      );
    });
  });

  describe("validateSkillFileMetadata", () => {
    it("retains strict file-boundary metadata validation", () => {
      assertEquals(
        validateSkillFileMetadata(
          {
            name: "test",
            description: "desc",
            "allowed-tools": [],
          },
          "test",
        ).allowedTools,
        [],
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              "allowed-tools": "Read",
              allowed_tools: "Write",
            },
            "test",
          ),
        TypeError,
        "must not declare both",
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              metadata: { version: 2 },
            },
            "test",
          ),
        TypeError,
        "metadata values must be strings",
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "x".repeat(2000),
            },
            "test",
          ),
        RangeError,
        "description exceeds",
      );
      for (const name of ["trailing-", "double--hyphen"]) {
        assertThrows(
          () =>
            validateSkillFileMetadata(
              { name, description: "desc" },
              name,
            ),
          Error,
          "Invalid skill name",
        );
      }
    });

    it("rejects accessor-backed allowed-tools without invoking getters", () => {
      let getterReads = 0;
      const allowedTools: string[] = [];
      Object.defineProperty(allowedTools, 0, {
        enumerable: true,
        get() {
          getterReads += 1;
          return "read_file";
        },
      });

      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              "allowed-tools": allowedTools,
            },
            "test",
          ),
        TypeError,
        "data property",
      );
      assertEquals(getterReads, 0);
    });
  });
});
