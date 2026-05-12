import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  DEFAULT_HOSTED_CHILD_AGENT_ID,
  hostedChildForkToolInputSchema,
  resolveHostedChildForkRuntimeConfig,
  resolveHostedChildForkThinkingOverride,
} from "./hosted-child-tool-input.ts";

Deno.test("hostedChildForkToolInputSchema accepts the hosted child fork fields", () => {
  const parsed = hostedChildForkToolInputSchema.parse({
    description: "review auth flow",
    prompt: "Review the authentication flow and report issues.",
    project_id: "project-123",
    tools: ["readFile", "bash"],
    model: "sonnet",
    thinking: 1024,
    max_steps: 12,
  });

  assertEquals(parsed, {
    description: "review auth flow",
    prompt: "Review the authentication flow and report issues.",
    project_id: "project-123",
    tools: ["readFile", "bash"],
    model: "sonnet",
    thinking: 1024,
    max_steps: 12,
  });
});

Deno.test("hostedChildForkToolInputSchema preserves omitted optional fork controls", () => {
  const parsed = hostedChildForkToolInputSchema.parse({
    description: "write tests",
    prompt: "Add focused tests for the changed helper.",
  });

  assertEquals(parsed, {
    description: "write tests",
    prompt: "Add focused tests for the changed helper.",
  });
});

Deno.test("hostedChildForkToolInputSchema rejects negative thinking budgets", () => {
  const result = hostedChildForkToolInputSchema.safeParse({
    description: "bad budget",
    prompt: "Try an invalid budget.",
    thinking: -1,
  });

  assertEquals(result.success, false);
});

Deno.test("DEFAULT_HOSTED_CHILD_AGENT_ID names the hosted child runtime agent", () => {
  assertEquals(DEFAULT_HOSTED_CHILD_AGENT_ID, "invoke-agent-child");
});

Deno.test("resolveHostedChildForkThinkingOverride maps child fork thinking values", () => {
  assertEquals(resolveHostedChildForkThinkingOverride(undefined), undefined);
  assertEquals(resolveHostedChildForkThinkingOverride(0), { enabled: false });
  assertEquals(resolveHostedChildForkThinkingOverride(2048), {
    enabled: true,
    budgetTokens: 2048,
  });
});

Deno.test("resolveHostedChildForkRuntimeConfig resolves reusable child fork runtime options", () => {
  const result = resolveHostedChildForkRuntimeConfig({
    forkInput: {
      description: "research solar panels",
      prompt: "Research solar panels and save the report to the project.",
      tools: ["readFile"],
      model: "sonnet",
      thinking: 1024,
      max_steps: 12,
    },
    contextModel: "opus",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    runId: "run-1",
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-for-${modelId}`,
  });

  assertEquals(result.description, "research solar panels");
  assertEquals(result.requestedTools, ["readFile"]);
  assertEquals(result.forkModel, "resolved-sonnet");
  assertEquals(result.provider, "provider-for-resolved-sonnet");
  assertEquals(result.maxSteps, 12);
  assertEquals(result.thinkingConfig, { enabled: true, budgetTokens: 1024 });
  assertEquals(
    result.effectivePrompt.includes("/research/solar-panels/runs/run-1.report.md"),
    true,
  );
});

Deno.test("resolveHostedChildForkRuntimeConfig falls back to context model and default max steps", () => {
  const result = resolveHostedChildForkRuntimeConfig({
    forkInput: {
      description: "write tests",
      prompt: "Write focused tests.",
    },
    contextModel: "opus",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    runId: "tool-call-1",
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-for-${modelId}`,
  });

  assertEquals(result.forkModel, "resolved-opus");
  assertEquals(result.provider, "provider-for-resolved-opus");
  assertEquals(result.maxSteps, 80);
  assertEquals(result.thinkingConfig, undefined);
  assertEquals(result.effectivePrompt, "Write focused tests.");
});
