import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createRuntimeAgentSystemMessages,
  parseRuntimeAgentMarkdownDefinition,
} from "./agent-definition.ts";

Deno.test("parseRuntimeAgentMarkdownDefinition normalizes frontmatter and instructions", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "support-agent",
    content: `---
name: Support Agent
description: Helps users resolve issues
model: gpt-5.4
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
    temperature: 0.2,
    thinking: { enabled: true, budgetTokens: 1200 },
    maxSteps: 8,
    providerTools: ["web_search", "web_fetch"],
    instructions: "Follow the support runbook.",
  });
});

Deno.test("parseRuntimeAgentMarkdownDefinition falls back to id and handles boolean thinking", () => {
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

Deno.test("createRuntimeAgentSystemMessages inserts runtime blocks at marker", () => {
  const result = createRuntimeAgentSystemMessages({
    agent: {
      id: "support",
      name: "Support",
      description: "Helps users",
      instructions: "Base instructions\n\n<!-- veryfront-runtime-context -->\n\nStatic policy",
    },
    runtimeBlocks: ['<project_context>\nproject_reference: "project-123"\n</project_context>'],
  });

  assertEquals(result.length, 1);
  assertEquals(
    result[0]?.content,
    'Base instructions\n\n<project_context>\nproject_reference: "project-123"\n</project_context>\n\nStatic policy',
  );
});

Deno.test("createRuntimeAgentSystemMessages appends runtime blocks when marker is absent", () => {
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
  assertEquals(result[0]?.content, "Base instructions\n\nDynamic context");
  assertEquals(result[1], {
    role: "system",
    content: "<environment_context>\nBrowser timezone: UTC\n</environment_context>",
  });
});
