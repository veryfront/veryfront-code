import { assertEquals } from "#veryfront/testing/assert.ts";
import { parseRuntimeAgentMarkdownDefinition } from "./runtime-agent-definition.ts";

Deno.test("parseRuntimeAgentMarkdownDefinition normalizes frontmatter and instructions", () => {
  const result = parseRuntimeAgentMarkdownDefinition({
    id: "support-agent",
    content: `---
name: Support Agent
description: Helps users resolve issues
model: gpt-5.4
thinking: 1200
max-steps: 8
---

Follow the support runbook.
`,
  });

  assertEquals(result, {
    id: "support-agent",
    name: "Support Agent",
    description: "Helps users resolve issues",
    model: "gpt-5.4",
    thinking: { enabled: true, budgetTokens: 1200 },
    maxSteps: 8,
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
