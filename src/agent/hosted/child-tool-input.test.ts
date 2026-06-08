import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  DEFAULT_HOSTED_CHILD_AGENT_ID,
  hostedChildForkToolInputSchema,
  resolveHostedChildForkRuntimeConfig,
  resolveHostedChildForkThinkingOverride,
} from "./child-tool-input.ts";

Deno.test("hostedChildForkToolInputSchema accepts the hosted child fork fields", () => {
  const parsed = hostedChildForkToolInputSchema.parse({
    description: "review auth flow",
    prompt: "Review the authentication flow and report issues.",
    context: {
      matched_invoice: {
        invoice_id: "INV-2026-00491",
        supplier: "Meyer Papier GmbH",
        amount: 2180,
      },
    },
    evidence_refs: [{
      run_id: "run_123",
      tool_call_id: "tool_123",
      result_path: "$.records[0]",
      label: "matched record",
    }],
    project_id: "project-123",
    tools: ["readFile", "bash"],
    model: "sonnet",
    thinking: 1024,
    max_steps: 12,
  });

  assertEquals(parsed, {
    description: "review auth flow",
    prompt: "Review the authentication flow and report issues.",
    context: {
      matched_invoice: {
        invoice_id: "INV-2026-00491",
        supplier: "Meyer Papier GmbH",
        amount: 2180,
      },
    },
    evidence_refs: [{
      run_id: "run_123",
      tool_call_id: "tool_123",
      result_path: "$.records[0]",
      label: "matched record",
    }],
    project_id: "project-123",
    tools: ["readFile", "bash"],
    model: "sonnet",
    thinking: 1024,
    max_steps: 12,
  });
});

Deno.test("resolveHostedChildForkRuntimeConfig appends structured context before evidence refs", () => {
  const result = resolveHostedChildForkRuntimeConfig({
    forkInput: {
      description: "release invoice",
      prompt: "Release the invoice if the structured context is valid.",
      context: {
        matched_invoice: {
          invoice_id: "INV-2026-00491",
          supplier: "Meyer Papier GmbH",
          amount: 2180,
          currency: "EUR",
        },
      },
      evidence_refs: [{
        run_id: "run_match",
        tool_call_id: "tool_match",
        result_path: "$.matched_invoices[1]",
      }],
    },
    contextModel: "opus",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    runId: "tool-call-1",
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-for-${modelId}`,
  });

  assertEquals(result.effectivePrompt.includes("<structured_context>"), true);
  assertEquals(result.effectivePrompt.includes('"supplier":"Meyer Papier GmbH"'), true);
  assertEquals(result.effectivePrompt.includes("<evidence_refs>"), true);
  assertEquals(
    result.effectivePrompt.indexOf("<structured_context>") <
      result.effectivePrompt.indexOf("<evidence_refs>"),
    true,
  );
  assertEquals(
    result.effectivePrompt.includes(
      "Treat structured_context as the authoritative data payload for the child task.",
    ),
    true,
  );
});

Deno.test("resolveHostedChildForkRuntimeConfig appends evidence refs as structured child context", () => {
  const result = resolveHostedChildForkRuntimeConfig({
    forkInput: {
      description: "release matched record",
      prompt: "Use the matched record and perform the requested action.",
      evidence_refs: [{
        run_id: "run_match",
        tool_call_id: "tool_match",
        result_path: "$.records[0]",
        label: "matched source record",
      }],
    },
    contextModel: "opus",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    runId: "tool-call-1",
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-for-${modelId}`,
  });

  assertEquals(result.effectivePrompt.includes("Use the matched record"), true);
  assertEquals(result.effectivePrompt.includes("<evidence_refs>"), true);
  assertEquals(result.effectivePrompt.includes('"run_id":"run_match"'), true);
  assertEquals(result.effectivePrompt.includes('"result_path":"$.records[0]"'), true);
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
      max_steps: 120,
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
  assertEquals(result.maxSteps, 120);
  assertEquals(result.thinkingConfig, { enabled: true, budgetTokens: 1024 });
  assertEquals(
    result.effectivePrompt.includes("/research/solar-panels/runs/run-1.report.md"),
    true,
  );
});

Deno.test("resolveHostedChildForkRuntimeConfig raises low requested child max steps to the hosted minimum", () => {
  const result = resolveHostedChildForkRuntimeConfig({
    forkInput: {
      description: "research services",
      prompt: "Research the available services and report findings.",
      max_steps: 15,
    },
    contextModel: "opus",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    runId: "tool-call-1",
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-for-${modelId}`,
  });

  assertEquals(result.maxSteps, 80);
});

Deno.test("resolveHostedChildForkRuntimeConfig preserves high requested child max steps", () => {
  const result = resolveHostedChildForkRuntimeConfig({
    forkInput: {
      description: "build feature",
      prompt: "Build the requested feature.",
      max_steps: 160,
    },
    contextModel: "opus",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    runId: "tool-call-1",
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-for-${modelId}`,
  });

  assertEquals(result.maxSteps, 160);
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
