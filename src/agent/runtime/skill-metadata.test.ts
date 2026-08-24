import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  createSkillDocumentParserProvider,
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { SKILL_NAME_REGEX, SKILL_PROVIDER_SAFE_ID_REGEX } from "#veryfront/skill/types.ts";
import {
  buildLegacyRuntimeFlatSkillDefinition,
  buildRuntimeDirectorySkillDefinition,
  buildRuntimeLoadedSkillResponse,
  buildRuntimeSkillDefinition,
  buildStrictRuntimeLoadedSkillResponse,
  getRuntimeSkillFrontmatterSchema,
  MAX_RUNTIME_SKILL_STEPS,
  normalizeRuntimeSkillReferencePath,
  normalizeStrictRuntimeSkillReferencePath,
  parseRuntimeSkillDocument,
  parseRuntimeSkillMetadata,
  parseStrictRuntimeSkillDocument,
  parseStrictRuntimeSkillMetadata,
  resolveRuntimeSkillSelectorForAgent,
  resolveRuntimeSkillsForAgent,
} from "./skill-metadata.ts";
import { buildStrictRuntimeAvailableSkillsPromptBlock } from "./skill-prompt.ts";

function withPollutedDescriptorPrototypeValue<T>(value: unknown, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    value,
  });
  try {
    return fn();
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, "value", original);
    } else {
      delete (Object.prototype as Record<string, unknown>).value;
    }
  }
}

Deno.test("strict runtime parsing honors one explicit Skill document parser generation", () => {
  const sources: string[] = [];
  const provider = createSkillDocumentParserProvider((source) => {
    sources.push(source);
    return {
      name: "provider-owned",
      description: "Decoded by the selected provider",
    };
  });

  const parsed = parseStrictRuntimeSkillDocument(
    "---\nignored: by-core\n---\nProvider body",
    { skillDocumentParserProvider: provider },
  );

  assertEquals(sources, ["ignored: by-core"]);
  assertEquals(parsed, {
    metadata: {
      name: "provider-owned",
      description: "Decoded by the selected provider",
      allowedTools: [],
      metadata: undefined,
      model: undefined,
      thinking: undefined,
      maxSteps: undefined,
    },
    body: "Provider body",
  });
});

Deno.test("strict runtime parsing sanitizes hostile parser failures without invoking hooks", () => {
  let trapCalls = 0;
  const hostile = new Proxy(new Error("must-not-leak"), {
    get() {
      trapCalls += 1;
      throw new Error("get trap must not run");
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error("getPrototypeOf trap must not run");
    },
  });
  const provider = createSkillDocumentParserProvider(() => {
    throw hostile;
  });
  const diagnostics: unknown[] = [];

  assertEquals(
    parseStrictRuntimeSkillDocument("---\nname: ignored\n---\nBody", {
      skillDocumentParserProvider: provider,
      logger: {
        error: (_message, metadata) => diagnostics.push(metadata?.error),
      },
    }),
    null,
  );
  assertEquals(trapCalls, 0);
  assertEquals(
    diagnostics,
    ["Skill frontmatter could not be decoded"],
  );
});

Deno.test("runtime parsing retains the captured extension default without a registry binding", () => {
  const previous = tryResolve<SkillDocumentParserProvider>(
    SkillDocumentParserProviderName,
  );
  unregister(SkillDocumentParserProviderName);
  try {
    assertEquals(
      parseRuntimeSkillDocument(
        "---\nname: strict\ndescription: Strict\n---\nBody",
      ),
      {
        metadata: {
          name: "strict",
          description: "Strict",
          allowedTools: [],
          metadata: undefined,
          model: undefined,
          thinking: undefined,
          maxSteps: undefined,
        },
        body: "Body",
      },
    );
    assertEquals(
      tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName),
      undefined,
    );
    assertEquals(parseRuntimeSkillDocument("Plain body"), {
      metadata: {
        name: undefined,
        description: undefined,
        allowedTools: [],
        metadata: undefined,
        model: undefined,
        thinking: undefined,
        maxSteps: undefined,
      },
      body: "Plain body",
    });
  } finally {
    if (previous !== undefined) register(SkillDocumentParserProviderName, previous);
  }
});

Deno.test("parseRuntimeSkillMetadata parses valid frontmatter", () => {
  const content = `---
name: My Skill
description: A useful skill
metadata:
  display_name: My Display Skill
  tier: project
---
Body content here`;
  const metadata = parseRuntimeSkillMetadata(content);
  assertExists(metadata);
  assertEquals(metadata.name, "My Skill");
  assertEquals(metadata.metadata, { display_name: "My Display Skill", tier: "project" });
  assertEquals(metadata.description, "A useful skill");
});

Deno.test("strict runtime metadata preserves strings without coercing untrusted values", () => {
  const content = `---
name: safe
description: Safe metadata
metadata:
  tier: project
---
Body`;
  const metadata = parseRuntimeSkillMetadata(content);
  assertExists(metadata);
  assertEquals(metadata.metadata, { tier: "project" });
  assertEquals(Object.isFrozen(metadata.metadata), true);

  const invalid = `---
name: unsafe
description: Invalid metadata
metadata:
  tier: 2
---
Body`;
  assertEquals(parseRuntimeSkillMetadata(invalid), null);
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

Deno.test("buildRuntimeSkillDefinition builds a canonical skill definition from valid content", () => {
  const content = `---
name: code-review
description: Reviews code quality
metadata:
  display_name: Code Review
---
# Code Review Skill
Review the code for quality issues.`;

  const skill = buildRuntimeSkillDefinition({ id: "code-review", content });
  assertExists(skill);
  assertEquals(skill.id, "code-review");
  assertEquals(skill.name, "code-review");
  assertEquals(skill.displayName, "Code Review");
  assertEquals(skill.description, "Reviews code quality");
  assertEquals(skill.metadata, { display_name: "Code Review" });
  assertEquals(skill.instructions, content);
});

Deno.test("generic runtime definitions reject unbounded mutable inputs", () => {
  assertEquals(
    buildRuntimeSkillDefinition({
      id: "Legacy Public / ID",
      content: "# Public fallback description\nBody",
      references: ["z.md", "a.md", "z.md"],
      ownerAgentId: "owner-only",
      sourcePath: "../raw\\source.md",
    }),
    null,
  );
});

Deno.test("buildRuntimeSkillDefinition recovers a legacy display-style frontmatter name", () => {
  const content = `---
name: Process Email
description: Process email
---
Body`;
  const skill = buildRuntimeSkillDefinition({ id: "process-email", content });
  assertExists(skill);
  assertEquals(skill.id, "process-email");
  assertEquals(skill.name, "process-email");
  assertEquals(skill.displayName, "Process Email");
});

Deno.test("buildRuntimeSkillDefinition rejects invalid canonical ids", () => {
  const errors: Array<Record<string, unknown> | undefined> = [];
  const skill = buildRuntimeSkillDefinition({
    id: "Process Email",
    content: `---
description: Process email
---
Body`,
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  assertEquals(skill, null);
  assertEquals(errors[0]?.id, "Process Email");
});

Deno.test("runtime skill identity admission ignores mutation of public matchers", () => {
  const originalNameTest = SKILL_NAME_REGEX.test;
  const originalProviderTest = SKILL_PROVIDER_SAFE_ID_REGEX.test;
  try {
    SKILL_NAME_REGEX.test = () => true;
    SKILL_PROVIDER_SAFE_ID_REGEX.test = () => true;

    assertEquals(
      buildRuntimeSkillDefinition({
        id: "invalid_name",
        content: "---\ndescription: Invalid global skill\n---\nBody",
      }),
      null,
    );
    assertEquals(
      buildRuntimeSkillDefinition({
        id: "invalid owned id",
        ownerAgentId: "owner",
        shortName: "invalid short name",
        content: "---\ndescription: Invalid owned skill\n---\nBody",
      }),
      null,
    );
  } finally {
    SKILL_NAME_REGEX.test = originalNameTest;
    SKILL_PROVIDER_SAFE_ID_REGEX.test = originalProviderTest;
  }
});

Deno.test("buildRuntimeSkillDefinition accepts provider-safe owned namespaced ids", () => {
  const content = `---
name: x_y
description: Owned helper
metadata:
  display_name: Owned Helper
---
Body`;
  const skill = buildRuntimeSkillDefinition({
    id: "a_b--x_y",
    content,
    ownerAgentId: "a.b",
    shortName: "x_y",
  });

  assertExists(skill);
  assertEquals(skill.id, "a_b--x_y");
  assertEquals(skill.name, "a_b--x_y");
  assertEquals(skill.displayName, "Owned Helper");
  assertEquals(skill.ownerAgentId, "a.b");
  assertEquals(skill.shortName, "x_y");
});

Deno.test("runtime skill id admission ignores mutations of public compatibility matchers", () => {
  const originalNameTest = SKILL_NAME_REGEX.test;
  const originalProviderSafeTest = SKILL_PROVIDER_SAFE_ID_REGEX.test;
  try {
    SKILL_NAME_REGEX.test = () => false;
    SKILL_PROVIDER_SAFE_ID_REGEX.test = () => false;
    assertExists(buildRuntimeSkillDefinition({ id: "valid-skill", content: "Body" }));
    assertExists(buildRuntimeSkillDefinition({
      id: "agent--owned_skill",
      content: "Body",
      ownerAgentId: "agent",
      shortName: "owned_skill",
    }));

    SKILL_NAME_REGEX.test = () => true;
    SKILL_PROVIDER_SAFE_ID_REGEX.test = () => true;
    assertEquals(buildRuntimeSkillDefinition({ id: "Invalid Skill", content: "Body" }), null);
    assertEquals(
      buildRuntimeSkillDefinition({
        id: "invalid/owned",
        content: "Body",
        ownerAgentId: "agent",
        shortName: "owned",
      }),
      null,
    );
  } finally {
    SKILL_NAME_REGEX.test = originalNameTest;
    SKILL_PROVIDER_SAFE_ID_REGEX.test = originalProviderSafeTest;
  }
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
  assertEquals(skill?.name, "test");
  assertEquals(skill?.displayName, "Test");
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

Deno.test("resolveRuntimeSkillSelectorForAgent returns a deterministic strict snapshot", () => {
  const globalCite = buildRuntimeSkillDefinition({
    id: "cite",
    content: "---\ndescription: Global citations\n---\nUse global citations.",
    sourcePath: "skills/cite/SKILL.md",
  })!;
  const ownedCite = buildRuntimeSkillDefinition({
    id: "researcher--helper",
    content: "---\ndescription: Research citations\n---\nUse research citations.",
    ownerAgentId: "researcher",
    shortName: "cite",
    sourcePath: "agents/researcher/skills/cite/SKILL.md",
  })!;
  const otherOwned = buildRuntimeSkillDefinition({
    id: "writer--style",
    content: "---\ndescription: Writer style\n---\nUse writer style.",
    ownerAgentId: "writer",
    shortName: "style",
    sourcePath: "agents/writer/skills/style/SKILL.md",
  })!;

  const selected = resolveRuntimeSkillSelectorForAgent({
    skills: [globalCite, ownedCite, otherOwned],
    agentId: "researcher",
    selector: ["cite", "cite"],
  });

  assertEquals(selected.policy, { kind: "allowlist", entries: ["cite", "cite"] });
  assertEquals(selected.allowedSkillIds, ["researcher--helper"]);
  assertEquals(selected.skillSourcePaths, {
    "researcher--helper": "agents/researcher/skills/cite/SKILL.md",
  });
  assertEquals(selected.definitions.map((skill) => skill.id), ["researcher--helper"]);

  const none = resolveRuntimeSkillSelectorForAgent({
    skills: [globalCite, ownedCite, otherOwned],
    agentId: "researcher",
    selector: [],
  });
  assertEquals(none.policy, { kind: "none" });
  assertEquals(none.allowedSkillIds, []);
});

Deno.test("resolveRuntimeSkillSelectorForAgent rejects unresolved explicit entries generically", () => {
  const otherOwned = buildRuntimeSkillDefinition({
    id: "writer--style",
    content: "---\ndescription: Writer style\n---\nUse writer style.",
    ownerAgentId: "writer",
    shortName: "style",
  })!;

  let rejected = false;
  try {
    resolveRuntimeSkillSelectorForAgent({
      skills: [otherOwned],
      agentId: "researcher",
      selector: ["writer--style"],
    });
  } catch (error) {
    rejected = true;
    const message = String(error);
    assertEquals(message.includes("configured skills are not available"), true);
    assertEquals(message.includes("writer--style"), false);
  }
  assertEquals(rejected, true);
});

Deno.test("resolveRuntimeSkillSelectorForAgent matches the canonical selector matrix", () => {
  const global = buildRuntimeSkillDefinition({
    id: "global",
    content: "---\ndescription: Global\n---\nGlobal.",
    sourcePath: "skills/global/SKILL.md",
  })!;
  const bundled = buildRuntimeSkillDefinition({
    id: "bundled",
    content: "---\ndescription: Bundled\n---\nBundled.",
    sourcePath: "bundled/skills/bundled/SKILL.md",
  })!;
  const ownCite = buildRuntimeSkillDefinition({
    id: "agent--cite",
    content: "---\ndescription: Own cite\n---\nCite.",
    ownerAgentId: "agent",
    shortName: "cite",
    sourcePath: "agents/agent/skills/cite/SKILL.md",
  })!;
  const otherStyle = buildRuntimeSkillDefinition({
    id: "other--style",
    content: "---\ndescription: Other style\n---\nStyle.",
    ownerAgentId: "other",
    shortName: "style",
    sourcePath: "agents/other/skills/style/SKILL.md",
  })!;
  const globalCite = buildRuntimeSkillDefinition({
    id: "cite",
    content: "---\ndescription: Global cite\n---\nGlobal cite.",
    sourcePath: "skills/cite/SKILL.md",
  })!;

  const skills = [global, bundled, ownCite, otherStyle, globalCite];
  const cases: Array<{
    selector: true | string[] | undefined;
    expectedPolicy: object;
    expectedIds: string[];
  }> = [
    {
      selector: undefined,
      expectedPolicy: { kind: "all-visible", source: "omitted" },
      expectedIds: ["global", "bundled", "agent--cite", "cite"],
    },
    {
      selector: true,
      expectedPolicy: { kind: "all-visible", source: "true" },
      expectedIds: ["global", "bundled", "agent--cite", "cite"],
    },
    {
      selector: [],
      expectedPolicy: { kind: "none" },
      expectedIds: [],
    },
    {
      selector: ["bundled", "cite", "global", "bundled"],
      expectedPolicy: { kind: "allowlist", entries: ["bundled", "cite", "global", "bundled"] },
      expectedIds: ["bundled", "agent--cite", "global"],
    },
  ];

  for (const testCase of cases) {
    const snapshot = resolveRuntimeSkillSelectorForAgent({
      skills,
      agentId: "agent",
      selector: testCase.selector,
    });
    assertEquals(snapshot.policy, testCase.expectedPolicy);
    assertEquals(snapshot.allowedSkillIds, testCase.expectedIds);
    assertEquals(snapshot.definitions.map((skill) => skill.id), testCase.expectedIds);
  }
});

Deno.test("resolveRuntimeSkillSelectorForAgent keeps the first visible duplicate id once", () => {
  const projectSkill = buildRuntimeSkillDefinition({
    id: "create",
    content: "---\ndescription: Project create\n---\nProject.",
    sourcePath: "skills/create/SKILL.md",
  })!;
  const bundledSkill = buildRuntimeSkillDefinition({
    id: "create",
    content: "---\ndescription: Bundled create\n---\nBundled.",
    sourcePath: "bundled/skills/create/SKILL.md",
  })!;

  const snapshot = resolveRuntimeSkillSelectorForAgent({
    skills: [projectSkill, bundledSkill],
    agentId: "agent",
    selector: ["create", "create"],
  });

  assertEquals(snapshot.allowedSkillIds, ["create"]);
  assertEquals(snapshot.definitions[0], projectSkill);
  assertEquals(snapshot.skillSourcePaths, { create: "skills/create/SKILL.md" });
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

Deno.test("buildRuntimeSkillDefinition rejects direct input accessors without invoking them", () => {
  let getterReads = 0;
  const input = {
    content: "---\nname: safe\ndescription: Safe\n---\nBody",
  } as Parameters<typeof buildRuntimeSkillDefinition>[0];
  Object.defineProperty(input, "id", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "safe";
    },
  });

  assertThrows(
    () => buildRuntimeSkillDefinition(input),
    TypeError,
    "data property",
  );
  assertEquals(getterReads, 0);
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

Deno.test("buildRuntimeDirectorySkillDefinition requires metadata and canonicalizes display names", () => {
  assertEquals(
    buildRuntimeDirectorySkillDefinition({
      id: "missing",
      content: "---\ndescription: Missing name\n---\nBody",
    }),
    null,
  );
  const renamed = buildRuntimeDirectorySkillDefinition({
    id: "expected",
    content: "---\nname: Different Name\ndescription: Display metadata\n---\nBody",
  });
  assertExists(renamed);
  assertEquals(renamed.name, "expected");
  assertEquals(renamed.displayName, "Different Name");
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

  const roundTrippedUnrestricted = JSON.parse(
    JSON.stringify(unrestricted),
  ) as typeof unrestricted;
  const roundTrippedNoTools = JSON.parse(JSON.stringify(noTools)) as typeof noTools;

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
  // `allowed-tools` is spec pre-approval metadata, never advertised to the model.
  assertEquals(unrestrictedLine.includes('"allowedTools"'), false);
  assertEquals(noToolsLine.includes('"allowedTools"'), false);
});

Deno.test("parseStrictRuntimeSkillMetadata rejects ambiguous and invalid allowed-tools", () => {
  assertEquals(
    parseStrictRuntimeSkillMetadata(
      "---\nallowed-tools: read_file\nallowed_tools: write_file\n---\nBody",
    ),
    null,
  );
  // `Bash(git:*)` is the Agent Skills spec's own documented example; a
  // spec-conformant skill must parse rather than be rejected by our grammar.
  assertEquals(
    parseStrictRuntimeSkillMetadata("---\nallowed-tools: Bash(git:*)\n---\nBody")?.allowedTools,
    ["Bash(git:*)"],
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

Deno.test("getRuntimeSkillFrontmatterSchema exposes the strict frontmatter contract", () => {
  assertEquals(
    getRuntimeSkillFrontmatterSchema().safeParse({
      model: "model\u0000escape",
      "max-steps": MAX_RUNTIME_SKILL_STEPS + 1,
    }).success,
    false,
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

Deno.test("strict runtime path byte limits ignore TextEncoder prototype mutation", () => {
  const originalEncode = Object.getOwnPropertyDescriptor(TextEncoder.prototype, "encode");
  let hookCalls = 0;
  const oversizedMultibytePath = Array.from({ length: 5 }, () => "é".repeat(200)).join("/");

  try {
    Object.defineProperty(TextEncoder.prototype, "encode", {
      configurable: true,
      value() {
        hookCalls += 1;
        return new Uint8Array();
      },
      writable: true,
    });
    assertEquals(normalizeStrictRuntimeSkillReferencePath(oversizedMultibytePath), null);
  } finally {
    if (originalEncode) {
      Object.defineProperty(TextEncoder.prototype, "encode", originalEncode);
    }
  }

  assertEquals(hookCalls, 0);
});

Deno.test("generic runtime parser and path helpers fail closed", () => {
  assertEquals(
    parseRuntimeSkillMetadata("x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1)),
    null,
  );
  assertEquals(normalizeRuntimeSkillReferencePath("C:\\private\\secret.md"), null);
  assertEquals(normalizeRuntimeSkillReferencePath("references/secret\u0000.md"), null);
});

Deno.test("buildRuntimeLoadedSkillResponse includes basic response fields", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "plan",
    instructions: "Plan carefully.",
  });

  assertEquals(response, {
    skillId: "plan",
    instructions: "Plan carefully.",
  });
});

Deno.test("buildRuntimeLoadedSkillResponse omits override forwarding when inventory is unknown", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "research",
    instructions: `---
model: sonnet
thinking: 2000
max-steps: 8
---
Research carefully.`,
    references: ["references/guide.md"],
  });

  assertEquals(response.model, "sonnet");
  assertEquals(response.thinking, 2000);
  assertEquals(response.maxSteps, 8);
  assertEquals(response.references, ["references/guide.md"]);
});

it("buildRuntimeLoadedSkillResponse omits override forwarding without invoke_agent", () => {
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "research",
    instructions: `---
model: sonnet
max-steps: 8
---
Research carefully.`,
  });

  assertEquals(response.model, "sonnet");
  assertEquals(response.maxSteps, 8);
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
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  assertEquals(response, {
    skillId: "invalid",
    instructions,
  });
  assertEquals(errors.length, 1);
});

Deno.test("buildRuntimeLoadedSkillResponse fails closed when metadata is invalid", () => {
  const instructions = `---
allowed-tools:
  - shell
  - 123
---
Body`;
  const response = buildRuntimeLoadedSkillResponse({
    skillId: "invalid",
    instructions,
  });

  assertEquals(response, {
    skillId: "invalid",
    instructions,
  });
});

Deno.test("buildRuntimeLoadedSkillResponse bounds direct inputs", () => {
  assertThrows(
    () =>
      buildRuntimeLoadedSkillResponse({
        skillId: "Legacy Public / ID",
        instructions: "Body",
      }),
    TypeError,
    "skillId",
  );
  assertThrows(
    () =>
      buildRuntimeLoadedSkillResponse({
        skillId: "bounded",
        instructions: "x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1),
      }),
    RangeError,
    `${SKILL_DOCUMENT_MAX_CHARACTERS}`,
  );
});

Deno.test("buildStrictRuntimeLoadedSkillResponse bounds direct response inputs", () => {
  const base = {
    skillId: "bounded",
    instructions: "Body",
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

Deno.test("buildStrictRuntimeLoadedSkillResponse rejects references outside readable skill directories", () => {
  const base = {
    skillId: "bounded",
    instructions: "Body",
  };

  assertThrows(
    () =>
      buildStrictRuntimeLoadedSkillResponse({
        ...base,
        references: ["scripts/run.ts"],
      }),
    TypeError,
    "references are invalid",
    "references outside the readable skill directories must be rejected",
  );
  assertThrows(
    () =>
      buildStrictRuntimeLoadedSkillResponse({
        ...base,
        references: ["notes.md"],
      }),
    TypeError,
    "references are invalid",
    "bare top-level references must be rejected",
  );
  assertEquals(
    buildStrictRuntimeLoadedSkillResponse({
      ...base,
      references: ["references/a.md", "resources/schema.json", "assets/logo.png"],
    }).references,
    ["assets/logo.png", "references/a.md", "resources/schema.json"],
    "references inside every readable skill directory must be returned intact",
  );
});

Deno.test("strict loaded responses reject direct accessors without invoking them", () => {
  let inputGetterReads = 0;
  const input = {
    instructions: "Body",
  } as Parameters<typeof buildStrictRuntimeLoadedSkillResponse>[0];
  Object.defineProperty(input, "skillId", {
    enumerable: true,
    get() {
      inputGetterReads += 1;
      return "bounded";
    },
  });

  assertThrows(
    () => buildStrictRuntimeLoadedSkillResponse(input),
    TypeError,
    "data property",
  );
  assertEquals(inputGetterReads, 0);
});

Deno.test("strict loaded responses reject reference accessors without invoking them", () => {
  let getterReads = 0;
  const references: string[] = [];
  Object.defineProperty(references, 0, {
    enumerable: true,
    get() {
      getterReads += 1;
      return "references/guide.md";
    },
  });

  assertThrows(
    () =>
      buildStrictRuntimeLoadedSkillResponse({
        skillId: "bounded",
        instructions: "Body",
        references,
      }),
    TypeError,
    "data property",
  );
  assertEquals(getterReads, 0);
});

Deno.test("strict loaded responses reject accessors despite inherited descriptor values", () => {
  let getterReads = 0;
  const input = {
    skillId: "bounded",
    instructions: "Body",
  } as Parameters<typeof buildStrictRuntimeLoadedSkillResponse>[0];
  Object.defineProperty(input, "references", {
    enumerable: true,
    get() {
      getterReads += 1;
      return ["references/accessor.md"];
    },
  });

  withPollutedDescriptorPrototypeValue(["references/injected.md"], () => {
    assertThrows(
      () => buildStrictRuntimeLoadedSkillResponse(input),
      TypeError,
      "data property",
    );
  });
  assertEquals(getterReads, 0);
});

Deno.test("strict loaded responses snapshot array lengths by descriptor", () => {
  let referenceLengthReads = 0;
  const references = new Proxy(["references/guide.md"], {
    get(target, key, receiver) {
      if (key === "length") {
        referenceLengthReads += 1;
        throw new Error("reference length getter must not run");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const response = buildStrictRuntimeLoadedSkillResponse({
    skillId: "bounded",
    instructions: "---\nallowed-tools: read_file\n---\nBody",
    references,
  });

  assertEquals(response.references, ["references/guide.md"]);
  assertEquals(referenceLengthReads, 0);
});
