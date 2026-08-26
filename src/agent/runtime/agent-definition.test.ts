import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRuntimeAgentSystemMessages,
  getRuntimeAgentMarkdownDefinitionSchema,
  parseRuntimeAgentMarkdownDefinition,
} from "./agent-definition.ts";

it("parseRuntimeAgentMarkdownDefinition normalizes frontmatter and instructions", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "support-agent",
    content: `---
name: Support Agent
description: Helps users resolve issues
model: gpt-5.4
avatar-url: https://cdn.example.com/agents/support.svg
temperature: 0.2
thinking: 1200
max-steps: 8
provider-tools:
  - web_search
  - web_fetch
---

Follow the support runbook.
`,
  });

  assertEquals(result, {
    id: "support-agent",
    name: "Support Agent",
    description: "Helps users resolve issues",
    model: "gpt-5.4",
    avatarUrl: "https://cdn.example.com/agents/support.svg",
    temperature: 0.2,
    thinking: { enabled: true, budgetTokens: 1200 },
    maxSteps: 8,
    providerTools: ["web_search", "web_fetch"],
    instructions: "Follow the support runbook.",
  });
});

it("parseRuntimeAgentMarkdownDefinition falls back to id and handles boolean thinking", () => {
  assertEquals(
    parseRuntimeAgentMarkdownDefinition({
      id: "writer",
      content: `---
thinking: false
---
Draft concise copy.
`,
    }),
    {
      id: "writer",
      name: "writer",
      description: "",
      thinking: { enabled: false },
      instructions: "Draft concise copy.",
    },
  );

  assertEquals(
    parseRuntimeAgentMarkdownDefinition({
      id: "planner",
      content: `---
thinking: true
---
Create a plan.
`,
    }).thinking,
    { enabled: true },
  );
});

it("parseRuntimeAgentMarkdownDefinition preserves an explicit empty skill selector", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "specialist",
    content: `---
skills: []
---
Use only the authored instructions.
`,
  });

  assertEquals(result.skills, []);
});

it("parseRuntimeAgentMarkdownDefinition preserves disabled skills", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "specialist",
    content: `---
skills: false
---
Use only the authored instructions.
`,
  });

  assertEquals(result.skills, false);
});

it("runtime agent definitions preserve structured system metadata", () => {
  const instructions = [{
    role: "system" as const,
    content: "Cache this prefix.",
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral", ttl: "1h" },
      },
    },
  }];

  const definition = getRuntimeAgentMarkdownDefinitionSchema().parse({
    id: "structured-agent",
    name: "Structured agent",
    description: "Preserves provider metadata",
    instructions: "Cache this prefix.",
    system: instructions,
  });

  assertEquals(definition.instructions, "Cache this prefix.");
  assertEquals(definition.system, instructions);
});

it("parseRuntimeAgentMarkdownDefinition rejects disabled tools", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "specialist",
        content: `---
tools: false
---
Use only the authored instructions.
`,
      }),
    Error,
    'Agent frontmatter "tools" must be an array of non-empty strings.',
  );
});

it("parseRuntimeAgentMarkdownDefinition parses denied tool aliases", () => {
  for (const field of ["denied-tools", "deniedTools"]) {
    const result = parseRuntimeAgentMarkdownDefinition({
      id: `locked-${field}`,
      content: `---
${field}:
  - load_skill
  - web_search
---
Keep denied tools unavailable.
`,
    });

    assertEquals(result.deniedTools, ["load_skill", "web_search"]);
  }
});

it("parseRuntimeAgentMarkdownDefinition rejects duplicate denied tool aliases", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "locked",
        content: `---
denied-tools: [load_skill]
deniedTools: [web_search]
---
Keep denied tools unavailable.
`,
      }),
    Error,
    'Agent frontmatter must use only one of "denied-tools" or "deniedTools".',
  );
});

it("parseRuntimeAgentMarkdownDefinition rejects malformed capability selectors", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "specialist",
        content: `---
skills: [" ", 7]
---
Use the selected skills.
`,
      }),
    Error,
    'Agent frontmatter "skills" entry 1 must be a non-empty string',
  );
});

describe("createRuntimeAgentSystemMessages", () => {
  it("falls back to authored instructions when structured system messages are empty", () => {
    const result = createRuntimeAgentSystemMessages({
      agent: {
        id: "empty-structured-system",
        name: "Empty structured system",
        description: "Uses authored instructions",
        instructions: "Keep the authored instructions.",
        system: [],
      },
    });

    assertEquals(result[0]?.content, "Keep the authored instructions.");
  });

  it("forwards the agent's provider alias so an authored cache breakpoint is recognized", () => {
    const result = createRuntimeAgentSystemMessages({
      agent: {
        id: "bedrock-agent",
        name: "Bedrock",
        description: "d",
        instructions: "ignored",
        model: "bedrock/claude-sonnet",
        system: [{
          role: "system",
          content: "Base",
          providerOptions: { bedrock: { cacheControl: { type: "ephemeral" } } },
        }],
      },
    });

    assertEquals(
      result[0]?.providerOptions,
      { bedrock: { cacheControl: { type: "ephemeral" } } },
      "the authored bedrock breakpoint is retained and no duplicate anthropic breakpoint is appended",
    );
  });

  it("keeps the prompt prefix static and moves runtime blocks before the authored tail", () => {
    const result = createRuntimeAgentSystemMessages({
      agent: {
        id: "support",
        name: "Support",
        description: "Helps users",
        instructions: "Base instructions\n\n<!-- veryfront-runtime-context -->\n\nStatic policy",
      },
      runtimeBlocks: ['<project_context>\nproject_reference: "project-123"\n</project_context>'],
    });

    assertEquals(result.length, 2);
    // Layer 0 contains only the prompt prefix before the marker.
    assertEquals(result[0]?.content, "Base instructions");
    // The dynamic message preserves marker placement around the runtime block.
    assertEquals(
      result[1]?.content,
      '<project_context>\nproject_reference: "project-123"\n</project_context>\n\nStatic policy',
    );
    assertEquals(result[1]?.providerOptions, undefined);
  });

  it("combines runtime blocks and environment in the dynamic tail", () => {
    const result = createRuntimeAgentSystemMessages({
      agent: {
        id: "support",
        name: "Support",
        description: "Helps users",
        instructions: "Base instructions",
      },
      runtimeBlocks: ["Dynamic context"],
      environmentContext: "Browser timezone: UTC",
    });

    assertEquals(result.length, 2);
    assertEquals(result[0]?.content, "Base instructions");
    assertEquals(
      result[1]?.content,
      "Dynamic context\n\n<environment_context>\nBrowser timezone: UTC\n</environment_context>",
    );
    assertEquals(result[1]?.providerOptions, undefined);
  });
});

it("parseRuntimeAgentMarkdownDefinition parses delegates frontmatter", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "lead",
    content: `---
name: Lead
delegates:
  - writer
  - editor
---
Coordinate the work.
`,
  });

  assertEquals(result.delegates, ["writer", "editor"]);

  const noDelegates = parseRuntimeAgentMarkdownDefinition({
    id: "solo",
    content: `---
name: Solo
---
Work alone.
`,
  });

  assertEquals(noDelegates.delegates, undefined);
});

it("parseRuntimeAgentMarkdownDefinition parses first-party MCP presets", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "project-reader",
    content: `---
name: Project reader
mcp-servers:
  - kind: veryfront-api
    toolPolicy:
      allow: [get_file, list_files]
---
Read project evidence.
`,
  });

  assertEquals(result.mcpServers, [{
    kind: "veryfront-api",
    toolPolicy: { allow: ["get_file", "list_files"] },
  }]);
});

it("parseRuntimeAgentMarkdownDefinition preserves an explicit empty delegate selector", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "writer",
    content: `---
name: Writer
delegates: []
---
Write copy.
`,
  });

  assertEquals(result.delegates, []);
});

it("parseRuntimeAgentMarkdownDefinition rejects implicit all-tools delegation", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "lead",
        content: `---
tools: true
delegates: [writer]
---
Coordinate.
`,
      }),
    Error,
    'Agent frontmatter for "lead" cannot combine delegates with tools: true',
  );
});

it("parseRuntimeAgentMarkdownDefinition rejects scalar capability declarations", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "lead",
        content: `---
delegates: writer
---
Coordinate.
`,
      }),
    Error,
    'Agent frontmatter "delegates" must be an array of non-empty strings',
  );
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "lead",
        content: `---
mcp-servers: disabled
---
Coordinate.
`,
      }),
    Error,
    'Agent frontmatter "mcp-servers" must be an array of MCP server configurations',
  );
});

it("parseRuntimeAgentMarkdownDefinition rejects self-delegation with a diagnostic", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "lead",
        content: `---
name: Lead
delegates: [writer, lead]
---
Coordinate.
`,
      }),
    Error,
    'Agent "lead" cannot delegate to itself',
  );
});

it("parseRuntimeAgentMarkdownDefinition rejects provider-unsafe delegate ids", () => {
  assertThrows(
    () =>
      parseRuntimeAgentMarkdownDefinition({
        id: "lead",
        content: `---
name: Lead
delegates: [data.fetcher]
---
Coordinate.
`,
      }),
    Error,
    'produces an invalid tool name "agent_data.fetcher"',
  );
});
