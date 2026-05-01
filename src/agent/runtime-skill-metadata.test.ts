import { assertEquals, assertExists } from "@std/assert";
import {
  buildRuntimeSkillDefinition,
  normalizeRuntimeSkillReferencePath,
  parseRuntimeSkillMetadata,
} from "./runtime-skill-metadata.ts";

Deno.test("parseRuntimeSkillMetadata parses valid frontmatter", () => {
  const content = `---
name: My Skill
description: A useful skill
---
Body content here`;
  const metadata = parseRuntimeSkillMetadata(content);
  assertExists(metadata);
  assertEquals(metadata.name, "My Skill");
  assertEquals(metadata.description, "A useful skill");
});

Deno.test("parseRuntimeSkillMetadata returns empty metadata for content without frontmatter", () => {
  const metadata = parseRuntimeSkillMetadata("no frontmatter here");
  assertExists(metadata);
  assertEquals(metadata.name, undefined);
  assertEquals(metadata.description, undefined);
});

Deno.test("parseRuntimeSkillMetadata returns empty metadata for empty content", () => {
  const metadata = parseRuntimeSkillMetadata("");
  assertExists(metadata);
  assertEquals(metadata.name, undefined);
});

Deno.test("buildRuntimeSkillDefinition builds a skill definition from valid content", () => {
  const content = `---
name: Code Review
description: Reviews code quality
---
# Code Review Skill
Review the code for quality issues.`;

  const skill = buildRuntimeSkillDefinition({ id: "code-review", content });
  assertExists(skill);
  assertEquals(skill.id, "code-review");
  assertEquals(skill.name, "Code Review");
  assertEquals(skill.description, "Reviews code quality");
  assertEquals(skill.instructions, content);
});

Deno.test("buildRuntimeSkillDefinition uses id as fallback name", () => {
  const content = `---
description: A skill
---
Body`;
  const skill = buildRuntimeSkillDefinition({ id: "my-skill", content });
  assertEquals(skill?.name, "my-skill");
});

Deno.test("buildRuntimeSkillDefinition extracts description from markdown body", () => {
  const content = `---
name: Test
---
# This is the heading
Some body text`;
  const skill = buildRuntimeSkillDefinition({ id: "test", content });
  assertEquals(skill?.description, "This is the heading");
});

Deno.test("buildRuntimeSkillDefinition builds a bare skill", () => {
  const skill = buildRuntimeSkillDefinition({ id: "bare", content: "Just a body" });
  assertExists(skill);
  assertEquals(skill.id, "bare");
  assertEquals(skill.name, "bare");
});

Deno.test("buildRuntimeSkillDefinition includes optional runtime fields", () => {
  const content = `---
name: Skill
description: Desc
model: sonnet
thinking: 5000
max-steps: 20
allowed-tools:
  - bash
  - readFile
---
Body`;
  const skill = buildRuntimeSkillDefinition({ id: "s1", content });
  assertEquals(skill?.model, "sonnet");
  assertEquals(skill?.thinking, 5000);
  assertEquals(skill?.maxSteps, 20);
  assertEquals(skill?.allowedTools, ["bash", "readFile"]);
});

Deno.test("buildRuntimeSkillDefinition parses comma and whitespace allowed-tools strings", () => {
  const commaSkill = buildRuntimeSkillDefinition({
    id: "comma",
    content: `---
allowed-tools: bash, readFile
---
Body`,
  });
  const whitespaceSkill = buildRuntimeSkillDefinition({
    id: "space",
    content: `---
allowed-tools: bash readFile
---
Body`,
  });

  assertEquals(commaSkill?.allowedTools, ["bash", "readFile"]);
  assertEquals(whitespaceSkill?.allowedTools, ["bash", "readFile"]);
});

Deno.test("buildRuntimeSkillDefinition includes references when provided", () => {
  const content = `---
name: Skill
description: Desc
---
Body`;
  const skill = buildRuntimeSkillDefinition({
    id: "s1",
    content,
    references: ["ref1.md", "ref2.md"],
  });
  assertEquals(skill?.references, ["ref1.md", "ref2.md"]);
});

Deno.test("buildRuntimeSkillDefinition omits references when empty", () => {
  const content = `---
name: Skill
description: Desc
---
Body`;
  const skill = buildRuntimeSkillDefinition({ id: "s1", content, references: [] });
  assertEquals(skill?.references, undefined);
});

Deno.test("buildRuntimeSkillDefinition returns null and logs invalid metadata", () => {
  const errors: Array<Record<string, unknown> | undefined> = [];
  const skill = buildRuntimeSkillDefinition({
    id: "invalid",
    content: `---
allowed-tools:
  - bash
  - 123
---
Body`,
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  assertEquals(skill, null);
  assertEquals(errors.length, 1);
});

Deno.test("normalizeRuntimeSkillReferencePath normalizes a simple path", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("docs/guide.md"), "docs/guide.md");
});

Deno.test("normalizeRuntimeSkillReferencePath converts backslashes", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("docs\\guide.md"), "docs/guide.md");
});

Deno.test("normalizeRuntimeSkillReferencePath trims whitespace", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("  docs/guide.md  "), "docs/guide.md");
});

Deno.test("normalizeRuntimeSkillReferencePath rejects absolute paths", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("/etc/passwd"), null);
});

Deno.test("normalizeRuntimeSkillReferencePath rejects parent traversal", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("../escape/attempt"), null);
});

Deno.test("normalizeRuntimeSkillReferencePath rejects dot segments", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("./relative"), null);
});

Deno.test("normalizeRuntimeSkillReferencePath rejects empty paths", () => {
  assertEquals(normalizeRuntimeSkillReferencePath(""), null);
  assertEquals(normalizeRuntimeSkillReferencePath("   "), null);
});

Deno.test("normalizeRuntimeSkillReferencePath rejects empty segments", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("docs//guide.md"), null);
});
