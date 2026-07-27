import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import {
  buildLegacyRuntimeFlatSkillDefinition,
  buildRuntimeDirectorySkillDefinition,
  buildRuntimeLoadedSkillResponse,
  buildRuntimeSkillDefinition,
  buildStrictRuntimeLoadedSkillResponse,
  hasRuntimeSkillAllowedToolsPolicy,
  MAX_RUNTIME_SKILL_MODEL_LENGTH,
  MAX_RUNTIME_SKILL_STEPS,
  MAX_RUNTIME_SKILL_THINKING_TOKENS,
  normalizeRuntimeSkillReferencePath,
  normalizeStrictRuntimeSkillReferencePath,
  parseRuntimeSkillMetadata,
  parseStrictRuntimeSkillMetadata,
  resolveRuntimeSkillsForAgent,
} from "./skill-metadata.ts";
import { buildStrictRuntimeAvailableSkillsPromptBlock } from "./skill-prompt.ts";

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
name: code-review
description: Reviews code quality
---
# Code Review Skill
Review the code for quality issues.`;

  const skill = buildRuntimeSkillDefinition({ id: "code-review", content });
  assertExists(skill);
  assertEquals(skill.id, "code-review");
  assertEquals(skill.name, "code-review");
  assertEquals(skill.description, "Reviews code quality");
  assertEquals(skill.instructions, content);
});

Deno.test("buildRuntimeSkillDefinition preserves its complete historical public contract", () => {
  const skill = buildRuntimeSkillDefinition({
    id: "Legacy Public / ID",
    content: "# Public fallback description\nBody",
    references: ["z.md", "a.md", "z.md"],
    ownerAgentId: "owner-only",
    sourcePath: "../raw\\source.md",
  });
  assertExists(skill);

  const allowedTools: string[] = skill.allowedTools;
  allowedTools.push("read_file");

  assertEquals(skill.id, "Legacy Public / ID");
  assertEquals(skill.name, "Legacy Public / ID");
  assertEquals(skill.description, "Public fallback description");
  assertEquals(skill.allowedTools, ["read_file"]);
  assertEquals(skill.references, ["z.md", "a.md", "z.md"]);
  assertEquals(skill.ownerAgentId, "owner-only");
  assertEquals(skill.shortName, undefined);
  assertEquals(skill.sourcePath, "../raw\\source.md");
  assertEquals(Object.isFrozen(skill), false);
  assertEquals(Object.isFrozen(skill.allowedTools), false);
});

Deno.test("buildLegacyRuntimeFlatSkillDefinition uses id as fallback name", () => {
  const content = `---
description: A skill
---
Body`;
  const skill = buildLegacyRuntimeFlatSkillDefinition({ id: "my-skill", content });
  assertEquals(skill?.name, "my-skill");
});

Deno.test("buildLegacyRuntimeFlatSkillDefinition extracts description from markdown body", () => {
  const content = `---
name: Test
---
# This is the heading
Some body text`;
  const skill = buildLegacyRuntimeFlatSkillDefinition({ id: "test", content });
  assertEquals(skill?.description, "This is the heading");
});

Deno.test("buildLegacyRuntimeFlatSkillDefinition builds a bare flat skill", () => {
  const skill = buildLegacyRuntimeFlatSkillDefinition({ id: "bare", content: "Just a body" });
  assertExists(skill);
  assertEquals(skill.id, "bare");
  assertEquals(skill.name, "bare");
});

Deno.test("resolveRuntimeSkillsForAgent applies owner visibility and short-name precedence", () => {
  const globalCite = buildRuntimeSkillDefinition({
    id: "cite",
    content: "---\nname: cite\ndescription: Global citations\n---\nUse global citations.",
  })!;
  const ownedCite = buildRuntimeSkillDefinition({
    id: "researcher--helper",
    content: "---\nname: cite\ndescription: Research citations\n---\nUse research citations.",
    ownerAgentId: "researcher",
    shortName: "cite",
  })!;
  const otherOwned = buildRuntimeSkillDefinition({
    id: "writer--style",
    content: "---\nname: style\ndescription: Writer style\n---\nUse writer style.",
    ownerAgentId: "writer",
    shortName: "style",
  })!;

  assertEquals(
    resolveRuntimeSkillsForAgent({
      skills: [globalCite, ownedCite, otherOwned],
      agentId: "researcher",
      selector: ["cite"],
    }).map((skill) => skill.id),
    ["researcher--helper"],
  );
  assertEquals(
    resolveRuntimeSkillsForAgent({
      skills: [globalCite, ownedCite, otherOwned],
      agentId: "researcher",
      selector: true,
    }).map((skill) => skill.id),
    ["cite", "researcher--helper"],
  );
});

Deno.test("buildRuntimeSkillDefinition includes optional runtime fields", () => {
  const content = `---
name: skill
description: Desc
model: sonnet
thinking: 5000
max-steps: 20
allowed-tools:
  - bash
  - readFile
---
Body`;
  const skill = buildRuntimeSkillDefinition({ id: "skill", content });
  assertEquals(skill?.model, "sonnet");
  assertEquals(skill?.thinking, 5000);
  assertEquals(skill?.maxSteps, 20);
  assertEquals(skill?.allowedTools, ["bash", "readFile"]);
});

Deno.test("parseRuntimeSkillMetadata preserves unbounded legacy overrides through its mutable public contract", () => {
  const metadata = parseRuntimeSkillMetadata(
    `---\nmodel: ${"m".repeat(MAX_RUNTIME_SKILL_MODEL_LENGTH + 1)}\nthinking: ${
      MAX_RUNTIME_SKILL_THINKING_TOKENS + 1
    }\nmax-steps: ${MAX_RUNTIME_SKILL_STEPS + 1}\n---\nBody`,
  );
  assertExists(metadata);
  const allowedTools: string[] = metadata.allowedTools;
  allowedTools.push("read_file");

  assertEquals(metadata.allowedTools, ["read_file"]);
  assertEquals(Object.isFrozen(metadata), false);
  assertEquals(metadata.model, "m".repeat(MAX_RUNTIME_SKILL_MODEL_LENGTH + 1));
  assertEquals(metadata.thinking, MAX_RUNTIME_SKILL_THINKING_TOKENS + 1);
  assertEquals(metadata.maxSteps, MAX_RUNTIME_SKILL_STEPS + 1);

  assertEquals(
    parseStrictRuntimeSkillMetadata(
      `---\nthinking: ${MAX_RUNTIME_SKILL_THINKING_TOKENS + 1}\n---\nBody`,
    ),
    null,
  );
  assertEquals(
    parseStrictRuntimeSkillMetadata(`---\nmax-steps: ${MAX_RUNTIME_SKILL_STEPS + 1}\n---\nBody`),
    null,
  );
  assertEquals(
    parseStrictRuntimeSkillMetadata('---\nmodel: "bad\\nmodel"\n---\nBody'),
    null,
  );
});

Deno.test("legacy flat adapter parses comma-delimited allowed-tools strings", () => {
  const commaSkill = buildLegacyRuntimeFlatSkillDefinition({
    id: "comma",
    content: `---
allowed-tools: bash, readFile
---
Body`,
  });
  assertEquals(commaSkill?.allowedTools, ["bash", "readFile"]);
});

Deno.test("buildRuntimeSkillDefinition parses spec whitespace allowed-tools strings", () => {
  const whitespaceSkill = buildRuntimeSkillDefinition({
    id: "space",
    content: `---
name: space
description: Space-delimited policy
allowed-tools: bash readFile
---
Body`,
  });

  assertEquals(whitespaceSkill?.allowedTools, ["bash", "readFile"]);
});

Deno.test("buildRuntimeSkillDefinition parses allowed_tools alias", () => {
  const skill = buildRuntimeSkillDefinition({
    id: "alias",
    content: `---
name: alias
description: Alias compatibility
allowed_tools: read_file write_file
---
Body`,
  });

  assertEquals(skill?.allowedTools, ["read_file", "write_file"]);
});

Deno.test("buildRuntimeSkillDefinition includes references when provided", () => {
  const content = `---
name: s1
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

Deno.test("buildRuntimeDirectorySkillDefinition snapshots and freezes advertised capabilities", () => {
  const references = ["references/z.md", "references/a.md", "references/a.md"];
  const skill = buildRuntimeDirectorySkillDefinition({
    id: "immutable",
    content:
      "---\nname: immutable\ndescription: Immutable definition\nallowed-tools: Read\n---\nBody",
    references,
    sourcePath: "skills/immutable/SKILL.md",
  });
  assertExists(skill);

  references.push("references/injected.md");

  assertEquals(skill.references, ["references/a.md", "references/z.md"]);
  assertEquals(Object.isFrozen(skill), true);
  assertEquals(Object.isFrozen(skill.references), true);
  assertEquals(Object.isFrozen(skill.allowedTools), true);
});

Deno.test("buildRuntimeSkillDefinition omits references when empty", () => {
  const content = `---
name: s1
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
name: invalid
description: Invalid policy
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

Deno.test("buildRuntimeDirectorySkillDefinition rejects unsafe ownership, sources, and references", () => {
  const content = "---\nname: safe\ndescription: Safe metadata\n---\nBody";
  assertEquals(
    buildRuntimeDirectorySkillDefinition({
      id: "safe",
      content,
      ownerAgentId: "agent",
    }),
    null,
  );
  assertEquals(
    buildRuntimeDirectorySkillDefinition({
      id: "safe",
      content,
      sourcePath: "../skills/safe/SKILL.md",
    }),
    null,
  );
  assertEquals(
    buildRuntimeDirectorySkillDefinition({
      id: "safe",
      content,
      references: ["../secret.md"],
    }),
    null,
  );
});

Deno.test("buildRuntimeDirectorySkillDefinition requires strict directory metadata", () => {
  assertEquals(
    buildRuntimeDirectorySkillDefinition({
      id: "missing",
      content: "---\ndescription: Missing name\n---\nBody",
    }),
    null,
  );
  assertEquals(
    buildRuntimeDirectorySkillDefinition({
      id: "expected",
      content: "---\nname: different\ndescription: Wrong directory\n---\nBody",
    }),
    null,
  );
});

Deno.test("parseRuntimeSkillMetadata preserves the historical always-present allowedTools array", () => {
  assertEquals(
    parseRuntimeSkillMetadata("---\ndescription: No declaration\n---\nBody")?.allowedTools,
    [],
  );
  assertEquals(
    parseRuntimeSkillMetadata("---\nallowed-tools: []\n---\nBody")?.allowedTools,
    [],
  );
  assertEquals(
    parseRuntimeSkillMetadata('---\nallowed-tools: ""\n---\nBody')?.allowedTools,
    [],
  );
});

Deno.test("strict directory catalog preserves omitted versus explicit-empty policies end to end", () => {
  const unrestricted = buildRuntimeDirectorySkillDefinition({
    id: "unrestricted",
    content: "---\nname: unrestricted\ndescription: No policy declared\n---\nBody",
  });
  const noTools = buildRuntimeDirectorySkillDefinition({
    id: "no-tools",
    content:
      "---\nname: no-tools\ndescription: Deliberately uses no direct tools\nallowed-tools: []\n---\nBody",
  });

  assertExists(unrestricted);
  assertExists(noTools);
  assertEquals(unrestricted.allowedTools, []);
  assertEquals(noTools.allowedTools, []);
  assertEquals(hasRuntimeSkillAllowedToolsPolicy(unrestricted), false);
  assertEquals(hasRuntimeSkillAllowedToolsPolicy(noTools), true);

  const roundTrippedUnrestricted = JSON.parse(
    JSON.stringify(unrestricted),
  ) as typeof unrestricted;
  const roundTrippedNoTools = JSON.parse(JSON.stringify(noTools)) as typeof noTools;
  assertEquals(hasRuntimeSkillAllowedToolsPolicy(roundTrippedUnrestricted), false);
  assertEquals(hasRuntimeSkillAllowedToolsPolicy(roundTrippedNoTools), true);

  const prompt = buildStrictRuntimeAvailableSkillsPromptBlock([
    roundTrippedUnrestricted,
    roundTrippedNoTools,
  ]);
  const unrestrictedLine = prompt.split("\n").find((line) =>
    line.includes('"skillId":"unrestricted"')
  );
  const noToolsLine = prompt.split("\n").find((line) => line.includes('"skillId":"no-tools"'));
  assertExists(unrestrictedLine);
  assertExists(noToolsLine);
  assertEquals(unrestrictedLine.includes('"allowedTools"'), false);
  assertStringIncludes(noToolsLine, '"allowedTools":[]');
});

Deno.test("parseRuntimeSkillMetadata preserves canonical precedence and legacy pattern acceptance", () => {
  assertEquals(
    parseRuntimeSkillMetadata(
      "---\nallowed-tools: read_file\nallowed_tools: write_file\n---\nBody",
    )?.allowedTools,
    ["read_file"],
  );
  assertEquals(
    parseRuntimeSkillMetadata("---\nallowed-tools: Bash(git:*)\n---\nBody")?.allowedTools,
    ["Bash(git:*)"],
  );

  const tooManyPatterns = Array.from(
    { length: SKILL_ALLOWED_TOOL_MAX_PATTERNS + 1 },
    (_, index) => `tool_${index}`,
  ).join(" ");
  assertEquals(
    parseRuntimeSkillMetadata(`---\nallowed-tools: ${tooManyPatterns}\n---\nBody`)?.allowedTools
      .length,
    SKILL_ALLOWED_TOOL_MAX_PATTERNS + 1,
  );
  assertEquals(
    parseRuntimeSkillMetadata(
      `---\nallowed-tools: a${"x".repeat(SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH)}\n---\nBody`,
    )?.allowedTools,
    [`a${"x".repeat(SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH)}`],
  );
});

Deno.test("parseStrictRuntimeSkillMetadata rejects ambiguous and invalid allowed-tools", () => {
  assertEquals(
    parseStrictRuntimeSkillMetadata(
      "---\nallowed-tools: read_file\nallowed_tools: write_file\n---\nBody",
    ),
    null,
  );
  assertEquals(
    parseStrictRuntimeSkillMetadata("---\nallowed-tools: Bash(git:*)\n---\nBody"),
    null,
  );

  const tooManyPatterns = Array.from(
    { length: SKILL_ALLOWED_TOOL_MAX_PATTERNS + 1 },
    (_, index) => `tool_${index}`,
  ).join(" ");
  assertEquals(
    parseStrictRuntimeSkillMetadata(`---\nallowed-tools: ${tooManyPatterns}\n---\nBody`),
    null,
  );
  assertEquals(
    parseStrictRuntimeSkillMetadata(
      `---\nallowed-tools: a${"x".repeat(SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH)}\n---\nBody`,
    ),
    null,
  );
});

Deno.test("strict parsing bounds documents without tightening the public parser", () => {
  const oversized = "x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1);
  assertExists(parseRuntimeSkillMetadata(oversized));
  assertEquals(
    parseStrictRuntimeSkillMetadata(oversized),
    null,
  );
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

Deno.test("normalizeRuntimeSkillReferencePath preserves its legacy absolute-path behavior", () => {
  assertEquals(normalizeRuntimeSkillReferencePath("/etc/passwd"), null);
  assertEquals(
    normalizeRuntimeSkillReferencePath("C:\\Windows\\system.ini"),
    "C:/Windows/system.ini",
  );
  assertEquals(normalizeRuntimeSkillReferencePath("\\\\server\\share\\secret.md"), null);
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

Deno.test("normalizeRuntimeSkillReferencePath preserves legacy unbounded path acceptance", () => {
  assertEquals(
    normalizeRuntimeSkillReferencePath("references/secret\u0000.md"),
    "references/secret\u0000.md",
  );
  assertEquals(
    normalizeRuntimeSkillReferencePath("references/secret\u009b.md"),
    "references/secret\u009b.md",
  );
  assertEquals(
    normalizeRuntimeSkillReferencePath(`references/${String.fromCharCode(0xd800)}.md`),
    `references/${String.fromCharCode(0xd800)}.md`,
  );
  assertEquals(
    normalizeRuntimeSkillReferencePath(`references/${"x".repeat(256)}.md`),
    `references/${"x".repeat(256)}.md`,
  );
});

Deno.test("normalizeStrictRuntimeSkillReferencePath rejects unsafe bounded paths", () => {
  assertEquals(normalizeStrictRuntimeSkillReferencePath("/etc/passwd"), null);
  assertEquals(normalizeStrictRuntimeSkillReferencePath("C:\\Windows\\system.ini"), null);
  assertEquals(normalizeStrictRuntimeSkillReferencePath("\\\\server\\share\\secret.md"), null);
  assertEquals(normalizeStrictRuntimeSkillReferencePath("references/secret\u0000.md"), null);
  assertEquals(normalizeStrictRuntimeSkillReferencePath("references/secret\u009b.md"), null);
  assertEquals(
    normalizeStrictRuntimeSkillReferencePath(
      `references/${String.fromCharCode(0xd800)}.md`,
    ),
    null,
  );
  assertEquals(
    normalizeStrictRuntimeSkillReferencePath(`references/${"x".repeat(256)}.md`),
    null,
  );
});

const loadedSkillMessages = {
  allowedToolsNote: "Use only allowed tools.",
  noCurrentRunToolsNote: "No direct tools are available.",
  unavailableCurrentRunToolsDelegationNote: "Delegate unavailable tools.",
  overrideNote: "Forward overrides.",
  referenceNote: "Load references separately.",
};

Deno.test("buildRuntimeLoadedSkillResponse includes basic response fields", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "plan",
    instructions: "Plan carefully.",
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
  });

  assertEquals(response, {
    skillId: "plan",
    instructions: "Plan carefully.",
    nextStep: "Continue after loading.",
  });
});

Deno.test("buildRuntimeLoadedSkillResponse filters allowed tools to current run surface", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "write",
    instructions: `---
allowed-tools: read_file, write_file, shell
---
Write carefully.`,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["read_file", "write_file", "invoke_agent"],
  });

  assertEquals(response.allowedTools, ["read_file", "write_file"]);
  assertEquals(response.delegationTools, ["read_file", "write_file", "shell"]);
  assertEquals(response.unavailableCurrentRunTools, ["shell"]);
  assertEquals(response.note, "Use only allowed tools.");
  assertEquals(response.delegationNote, "Delegate unavailable tools.");
});

Deno.test("buildRuntimeLoadedSkillResponse preserves legacy exact-name tool intersection", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "api-reader",
    instructions: "---\nallowed-tools: api:*\n---\nRead API data.",
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["api:list", "read_file"],
  });

  assertEquals(response.allowedTools, []);
  assertEquals(response.unavailableCurrentRunTools, ["api:*"]);
  assertEquals(response.note, "No direct tools are available.");
});

Deno.test("buildStrictRuntimeLoadedSkillResponse intersects prefix policies by match semantics", () => {
  const response = buildStrictRuntimeLoadedSkillResponse({
    skillId: "api-reader",
    instructions: "---\nallowed-tools: api:*\n---\nRead API data.",
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["api:list", "read_file"],
  });

  assertEquals(response.allowedTools, ["api:*"]);
  assertEquals(response.unavailableCurrentRunTools, undefined);
  assertEquals(response.note, "Use only allowed tools.");
});

Deno.test("buildRuntimeLoadedSkillResponse omits delegation note when no delegate tools are available", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "write",
    instructions: `---
allowed-tools:
  - shell
---
Write carefully.`,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["read_file"],
  });

  assertEquals(response.allowedTools, []);
  assertEquals(response.delegationTools, ["shell"]);
  assertEquals(response.unavailableCurrentRunTools, ["shell"]);
  assertEquals(response.note, "No direct tools are available.");
  assertEquals(response.delegationNote, undefined);
});

Deno.test("buildRuntimeLoadedSkillResponse treats an explicit empty tool surface as no tools", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "research",
    instructions: `---
allowed-tools:
  - read_file
model: sonnet
max-steps: 8
---
Research carefully.`,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: [],
  });

  assertEquals(response.allowedTools, []);
  assertEquals(response.delegationTools, ["read_file"]);
  assertEquals(response.unavailableCurrentRunTools, ["read_file"]);
  assertEquals(response.note, "No direct tools are available.");
  assertEquals(response.delegationNote, undefined);
  assertEquals(response.model, "sonnet");
  assertEquals(response.maxSteps, 8);
  assertEquals(response.overrideNote, undefined);
});

Deno.test("buildRuntimeLoadedSkillResponse keeps delegation note for scoped delegate tools", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "write",
    instructions: `---
allowed-tools:
  - shell
---
Write carefully.`,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["agent_writer", "read_file"],
  });

  assertEquals(response.allowedTools, []);
  assertEquals(response.unavailableCurrentRunTools, ["shell"]);
  assertEquals(response.delegationNote, "Delegate unavailable tools.");
});

Deno.test("buildRuntimeLoadedSkillResponse preserves runtime overrides and references", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "research",
    instructions: `---
model: sonnet
thinking: 2000
max-steps: 8
---
Research carefully.`,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    references: ["references/guide.md"],
  });

  assertEquals(response.model, "sonnet");
  assertEquals(response.thinking, 2000);
  assertEquals(response.maxSteps, 8);
  assertEquals(response.overrideNote, "Forward overrides.");
  assertEquals(response.references, ["references/guide.md"]);
  assertEquals(response.referenceNote, "Load references separately.");
});

Deno.test("buildRuntimeLoadedSkillResponse omits override forwarding without legacy invoke_agent", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "research",
    instructions: `---
model: sonnet
max-steps: 8
---
Research carefully.`,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["agent_researcher", "read_file"],
  });

  assertEquals(response.model, "sonnet");
  assertEquals(response.maxSteps, 8);
  assertEquals(response.overrideNote, undefined);
});

Deno.test("buildRuntimeLoadedSkillResponse preserves the legacy base response for invalid metadata", () => {
  const instructions = `---
allowed-tools:
  - shell
  - 123
---
Body`;
  const errors: Array<Record<string, unknown> | undefined> = [];
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "invalid",
    instructions,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  assertEquals(response, {
    skillId: "invalid",
    instructions,
    nextStep: "Continue after loading.",
  });
  assertEquals(errors.length, 1);
});

Deno.test("buildStrictRuntimeLoadedSkillResponse fails closed when metadata is invalid", () => {
  const instructions = `---
allowed-tools:
  - shell
  - 123
---
Body`;
  const errors: Array<Record<string, unknown> | undefined> = [];
  const response = buildStrictRuntimeLoadedSkillResponse({
    skillId: "invalid",
    instructions,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  assertEquals(response, {
    skillId: "invalid",
    instructions,
    nextStep: "Continue after loading.",
    allowedTools: [],
    delegationTools: [],
    note: "No direct tools are available.",
  });
  assertEquals(errors.length, 1);
});

Deno.test("buildRuntimeLoadedSkillResponse preserves legacy explicit-empty policy behavior", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "read-only",
    instructions: "---\nallowed-tools: []\n---\nRead without tools.",
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["read_file"],
  });

  assertEquals(response.allowedTools, undefined);
  assertEquals(response.delegationTools, undefined);
  assertEquals(response.note, undefined);
});

Deno.test("buildStrictRuntimeLoadedSkillResponse enforces an explicit empty allowed-tools policy", () => {
  const response = buildStrictRuntimeLoadedSkillResponse({
    skillId: "read-only",
    instructions: "---\nallowed-tools: []\n---\nRead without tools.",
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    availableToolNames: ["read_file"],
  });

  assertEquals(response.allowedTools, []);
  assertEquals(response.delegationTools, []);
  assertEquals(response.note, "No direct tools are available.");
});

Deno.test("buildRuntimeLoadedSkillResponse preserves legacy unbounded direct inputs", () => {
  const instructions = "x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1);
  const references = Array.from(
    { length: SKILL_LOADABLE_REFERENCE_MAX_ENTRIES + 1 },
    (_unused, index) => index === 0 ? "../legacy\\reference.md" : `ref-${index}.md`,
  );
  const availableToolNames = Array.from(
    { length: SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES + 1 },
    (_unused, index) => index === 0 ? `tool\u0000${index}` : `tool_${index}`,
  );

  const response = buildRuntimeLoadedSkillResponse({
    skillId: "Legacy Public / ID",
    instructions,
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
    references,
    availableToolNames,
  });

  assertEquals(response.skillId, "Legacy Public / ID");
  assertEquals(response.instructions, instructions);
  assertEquals(response.references, references);
});

Deno.test("buildStrictRuntimeLoadedSkillResponse bounds direct response inputs", () => {
  const base = {
    skillId: "bounded",
    instructions: "Body",
    nextStep: "Continue after loading.",
    messages: loadedSkillMessages,
  };

  assertThrows(
    () =>
      buildStrictRuntimeLoadedSkillResponse({
        ...base,
        instructions: "x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1),
      }),
    RangeError,
    `${SKILL_DOCUMENT_MAX_CHARACTERS}`,
  );
  assertThrows(
    () =>
      buildStrictRuntimeLoadedSkillResponse({
        ...base,
        availableToolNames: Array.from(
          { length: SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES + 1 },
          (_unused, index) => `tool_${index}`,
        ),
      }),
    RangeError,
    `${SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES}`,
  );
  const aggregateReferences = [
    ...Array.from(
      { length: SKILL_SUBDIR_MAX_ENTRIES },
      (_unused, index) => `references/ref-${index}.md`,
    ),
    "resources/schema.json",
  ];
  assertEquals(
    buildStrictRuntimeLoadedSkillResponse({
      ...base,
      references: aggregateReferences,
    }).references?.length,
    aggregateReferences.length,
  );
  assertThrows(
    () =>
      buildStrictRuntimeLoadedSkillResponse({
        ...base,
        references: Array.from(
          { length: SKILL_LOADABLE_REFERENCE_MAX_ENTRIES + 1 },
          (_unused, index) => `references/ref-${index}.md`,
        ),
      }),
    TypeError,
    "references",
  );
});
