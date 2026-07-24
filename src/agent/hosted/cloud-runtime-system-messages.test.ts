import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  buildVeryfrontCloudRuntimeInstructions,
  createVeryfrontCloudRuntimeSystemMessages,
} from "./cloud-runtime-system-messages.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

function createAgent(
  overrides: Partial<RuntimeAgentMarkdownDefinition> = {},
): RuntimeAgentMarkdownDefinition {
  return {
    id: "assistant",
    name: "Assistant",
    description: "A test assistant",
    instructions: "Base instructions\n\n<!-- veryfront-runtime-context -->\n\nStatic tail",
    ...overrides,
  };
}

Deno.test("createVeryfrontCloudRuntimeSystemMessages inserts project instructions and context at runtime marker", () => {
  const [message] = createVeryfrontCloudRuntimeSystemMessages({
    agent: createAgent(),
    instructions: "Use the project policy.",
    projectId: "project-123",
    branchId: "branch-456",
  });

  assertEquals(message?.role, "system");
  assertStringIncludes(message?.content ?? "", "Base instructions");
  assertStringIncludes(message?.content ?? "", "<project_instructions>");
  assertStringIncludes(message?.content ?? "", "Use the project policy.");
  assertStringIncludes(message?.content ?? "", "<project_context>");
  assertStringIncludes(message?.content ?? "", 'project_reference: "project-123"');
  assertStringIncludes(message?.content ?? "", 'branch_id: "branch-456"');
  assertStringIncludes(message?.content ?? "", "Static tail");
});

Deno.test("createVeryfrontCloudRuntimeSystemMessages uses main branch guidance when branch id is absent", () => {
  const [message] = createVeryfrontCloudRuntimeSystemMessages({
    agent: createAgent(),
    projectId: "project-123",
  });

  assertStringIncludes(
    message?.content ?? "",
    "branch_id: main (no branch_id needed for file operations)",
  );
});

Deno.test("createVeryfrontCloudRuntimeSystemMessages includes skills and environment context", () => {
  const skills: RuntimeSkillDefinition[] = [
    {
      id: "deploy",
      name: "Deploy",
      description: "Deployment guidance",
      instructions: "Deploy carefully.",
      allowedTools: [],
      references: [],
    },
  ];

  const messages = createVeryfrontCloudRuntimeSystemMessages({
    agent: createAgent({ instructions: "Base instructions" }),
    skills,
    environmentContext: "Runtime facts",
  });

  assertEquals(messages.length, 2);
  assertStringIncludes(messages[0]?.content ?? "", "<available_skills>");
  assertStringIncludes(messages[0]?.content ?? "", "Deployment guidance");
  assertEquals(messages[1]?.role, "system");
  assertStringIncludes(messages[1]?.content ?? "", "<environment_context>");
  assertStringIncludes(messages[1]?.content ?? "", "Runtime facts");
});

Deno.test("createVeryfrontCloudRuntimeSystemMessages scopes skill delegation to available tools", () => {
  const skills: RuntimeSkillDefinition[] = [
    {
      id: "review",
      name: "Review",
      description: "Review guidance",
      instructions: "Review carefully.",
      allowedTools: [],
    },
  ];

  const [message] = createVeryfrontCloudRuntimeSystemMessages({
    agent: createAgent({ instructions: "Base instructions" }),
    skills,
    availableToolNames: ["agent_reviewer", "load_skill"],
  });

  assertStringIncludes(
    message?.content ?? "",
    "When delegating, use only these available scoped delegation tools: `agent_reviewer`.",
  );
  assertEquals((message?.content ?? "").includes("invoke_agent"), false);
  assertEquals((message?.content ?? "").includes("Pass through any returned model"), false);
});

Deno.test("buildVeryfrontCloudRuntimeInstructions adapts hosted preparation input", () => {
  const messages = buildVeryfrontCloudRuntimeInstructions({
    agentConfig: createAgent(),
    projectId: "project-123",
    branchId: null,
    environmentContext: "Runtime facts",
    instructions: "Use the project policy.",
    skills: [],
  });

  const message = messages[0];
  const environmentMessage = messages[1];

  assertEquals(message?.role, "system");
  assertStringIncludes(message?.content ?? "", "Use the project policy.");
  assertStringIncludes(message?.content ?? "", 'project_reference: "project-123"');
  assertEquals(environmentMessage?.role, "system");
  assertStringIncludes(environmentMessage?.content ?? "", "Runtime facts");
});
